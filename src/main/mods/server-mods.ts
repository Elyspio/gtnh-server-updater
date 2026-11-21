import path from "node:path";
import type { ActiveCustomMod, InstalledMod, ModBackup, ModBackupRecord, ModTargetState } from "@shared/mods.types";
import { quoteShell, type RemoteClient } from "../ssh/remote-client";
import { assertRequiredTools, resolveDirectory } from "../ssh/remote-operations";
import { BACKUP_DIRECTORY, BACKUP_RECORD, isBackupId, parseBackupRecord, restoreSource, sortBackups } from "./backup-policy";
import { assertSafeModId } from "./mod-info";
import { matchMod, parseScannedJars, scanJarsScript, type ModMatch } from "./mod-match";

export const SERVER_TOOLS = ["sh", "systemctl", "unzip", "sha256sum", "stat", "chown", "chmod", "mv", "cp", "rm", "mkdir", "grep", "head", "tail", "ls"] as const;

const SERVICE_NAME = /^[A-Za-z0-9@._:-]{1,128}$/;
const BACKUP_MARKER = "@@GTNH-BACKUP@@";

export type ServiceLocation = { serviceName: string; serverPath: string; serviceState: string };

/** What a server holds for one modid: the JAR in place, its backups, and the resulting state. */
export type ServerInspection = { location: ServiceLocation; match: ModMatch; current?: InstalledMod; backups: ModBackup[]; state: ModTargetState };

export function assertServiceName(value: string): string {
	const name = value.trim();
	if (!SERVICE_NAME.test(name) || name.startsWith("-")) throw new Error(`Invalid systemd service name: ${value}`);
	return name;
}

/** Reads the server folder from the unit itself, so no path is retyped after an update. */
export async function locateService(client: RemoteClient, serviceName: string): Promise<ServiceLocation> {
	const name = assertServiceName(serviceName);
	await assertRequiredTools(client, SERVER_TOOLS);
	if ((await client.executeChecked("id -u")).trim() !== "0") {
		throw new Error("Restarting a systemd service needs the root account; the app never uses sudo");
	}
	const properties = parseProperties(await client.executeChecked(`systemctl show -p LoadState -p ActiveState -p WorkingDirectory -- ${quoteShell(name)}`));
	if (properties.LoadState !== "loaded") throw new Error(`systemd service ${name} is not installed (${properties.LoadState || "unknown"})`);
	const workingDirectory = (properties.WorkingDirectory ?? "").replace(/^[-!]+/, "");
	if (!workingDirectory.startsWith("/")) throw new Error(`systemd service ${name} has no absolute WorkingDirectory`);
	const serverPath = await resolveDirectory(client, workingDirectory, "Server folder", true);
	return { serviceName: name, serverPath, serviceState: properties.ActiveState ?? "unknown" };
}

export async function inspectServer(client: RemoteClient, serviceName: string, modId: string): Promise<ServerInspection> {
	assertSafeModId(modId);
	const location = await locateService(client, serviceName);
	const root = location.serverPath;
	const match = matchMod(parseScannedJars(await client.executeChecked(`cd ${quoteShell(root)} && {\n${scanJarsScript()}\n}`)), modId);
	const backups = await readServerBackups(client, root, modId);
	if (match.status === "absent") return { location, match, backups, state: { status: "absent" } };
	if (match.status === "ambiguous") return { location, match, backups, state: { status: "ambiguous", files: match.files } };

	const relativePath = match.jar.relativePath;
	const current: InstalledMod = {
		relativePath,
		fileName: path.posix.basename(relativePath),
		version: match.version,
		sha256: await remoteSha256(client, `${root}/${relativePath}`),
	};
	const source = restoreSource(backups, current.sha256);
	return {
		location,
		match,
		current,
		backups,
		state: { status: "ready", current, restore: source && { backupId: source.id, fileName: path.posix.basename(source.record.originalFile) } },
	};
}

export async function readServerBackups(client: RemoteClient, root: string, modId: string): Promise<ModBackup[]> {
	const directory = `${root}/${BACKUP_DIRECTORY}/${assertSafeModId(modId)}`;
	const output = await client.executeChecked(backupRecordsScript(`${quoteShell(directory)}/*/`));
	return sortBackups(parseBackups(output).filter((backup) => backup.record.modId === modId));
}

/** Mods the app replaced in a server folder and that are still in place (for the update report). */
export async function findActiveCustomMods(client: RemoteClient, root: string): Promise<ActiveCustomMod[]> {
	const output = await client.executeChecked(backupRecordsScript(`${quoteShell(`${root}/${BACKUP_DIRECTORY}`)}/*/*/`));
	const latest = new Map<string, ModBackup>();
	for (const backup of sortBackups(parseBackups(output))) latest.set(backup.record.modId, backup);
	const active: ActiveCustomMod[] = [];
	for (const { record } of latest.values()) {
		const file = `${root}/${record.installedFile}`;
		if ((await client.execute(`test -f ${quoteShell(file)}`)).exitCode !== 0) continue;
		if ((await remoteSha256(client, file)) !== record.installedSha256) continue;
		active.push({ modId: record.modId, installedFile: record.installedFile, originalFile: record.originalFile, createdAt: record.createdAt });
	}
	return active.sort((left, right) => left.modId.localeCompare(right.modId));
}

export async function remoteSha256(client: RemoteClient, file: string): Promise<string> {
	const sum = (await client.executeTrackedChecked(`sha256sum -- ${quoteShell(file)}`)).trim().split(/\s+/)[0] ?? "";
	if (!/^[0-9a-f]{64}$/.test(sum)) throw new Error(`Unable to hash ${file}`);
	return sum;
}

export async function writeBackupRecord(client: RemoteClient, backupDirectory: string, record: ModBackupRecord): Promise<void> {
	await client.writeFile(`${backupDirectory}/${BACKUP_RECORD}`, Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8"));
}

/** Prints each backup folder name, then its record. `glob` is already quoted, ending with `/`. */
export function backupRecordsScript(glob: string): string {
	return [
		`for d in ${glob}; do`,
		`  [ -f "\${d}${BACKUP_RECORD}" ] || continue`,
		`  printf '\\n%s%s\\n' '${BACKUP_MARKER}' "$(basename "$d")"`,
		`  head -c 65536 "\${d}${BACKUP_RECORD}"`,
		"done",
	].join("\n");
}

function parseBackups(output: string): ModBackup[] {
	const backups: ModBackup[] = [];
	for (const chunk of output.split(`\n${BACKUP_MARKER}`).slice(1)) {
		const newline = chunk.indexOf("\n");
		if (newline < 0) continue;
		const id = chunk.slice(0, newline).trim();
		if (!isBackupId(id)) continue;
		try {
			backups.push({ id, record: parseBackupRecord(chunk.slice(newline + 1)) });
		} catch {
			// A damaged record is ignored: it can neither be restored nor break the chain.
		}
	}
	return backups;
}

function parseProperties(output: string): Record<string, string> {
	const properties: Record<string, string> = {};
	for (const line of output.split(/\r?\n/)) {
		const separator = line.indexOf("=");
		if (separator > 0) properties[line.slice(0, separator)] = line.slice(separator + 1).trim();
	}
	return properties;
}
