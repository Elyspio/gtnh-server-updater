import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InstalledMod, ModBackup, ModBackupRecord, ModJar, ModTargetState } from "@shared/mods.types";
import { BACKUP_DIRECTORY, BACKUP_RECORD, backupsToPrune, isBackupId, newBackupId, parseBackupRecord, restoreSource, sortBackups } from "./backup-policy";
import { assertJarFileName, assertSafeModId, parseModInfo, singleMod } from "./mod-info";
import { MOD_FOLDERS, matchMod, type ModMatch, type ScannedJar } from "./mod-match";
import { readZipEntry } from "./zip-entry";

export type PrismInstance = { id: string; name: string; directory: string; minecraftDirectory?: string };

export type LocalInspection = { match: ModMatch; current?: InstalledMod; backups: ModBackup[]; state: ModTargetState };

export async function fileSha256(file: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

/**
 * Gradle writes these next to the mod JAR with the same mcmod.info: a deobfuscated `-dev`
 * JAR crashes a real game, the others hold no runnable mod.
 */
const BUILD_SIDE_JAR = /-(dev|sources|javadoc|api|deobf)\.jar$/i;

/** Reads a JAR chosen to replace a mod: exactly one modid in its mcmod.info. */
export async function readModJar(file: string): Promise<ModJar> {
	const fileName = assertJarFileName(path.basename(file));
	if (BUILD_SIDE_JAR.test(fileName)) throw new Error(`${fileName} is a development, sources or API JAR; a game cannot load it in place of the mod`);
	const info = await stat(file);
	if (!info.isFile()) throw new Error(`${file} is not a file`);
	const content = await readZipEntry(file, "mcmod.info");
	if (!content) throw new Error(`${fileName} has no mcmod.info`);
	const mod = singleMod(parseModInfo(content.toString("utf8")), fileName);
	return { path: file, fileName, modId: mod.modId, name: mod.name, version: mod.version, sizeBytes: info.size, modifiedAt: info.mtimeMs, sha256: await fileSha256(file) };
}

/** Mod JARs of a folder (not recursive), newest first. Unreadable, multi-mod and build-side JARs are skipped. */
export async function scanModJars(folder: string): Promise<ModJar[]> {
	const names = (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.jar$/i.test(entry.name)).map((entry) => entry.name);
	const jars: ModJar[] = [];
	for (const name of names) {
		try {
			jars.push(await readModJar(path.join(folder, name)));
		} catch {
			// Not a single-mod JAR a game can load.
		}
	}
	return jars.sort((left, right) => right.modifiedAt - left.modifiedAt || left.fileName.localeCompare(right.fileName));
}

/** JARs of a folder declaring the modid, newest first. */
export async function listModJars(folder: string, modId: string): Promise<ModJar[]> {
	return (await scanModJars(folder)).filter((jar) => jar.modId === modId);
}

/** PrismLauncher's instance folder, honouring `InstanceDir` from prismlauncher.cfg. */
export function defaultPrismDirectory(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
	const home = os.homedir();
	const data =
		platform === "win32"
			? path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "PrismLauncher")
			: platform === "darwin"
				? path.join(home, "Library", "Application Support", "PrismLauncher")
				: path.join(env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "PrismLauncher");
	try {
		const config = readIni(readFileSync(path.join(data, "prismlauncher.cfg"), "utf8"));
		const configured = config.InstanceDir;
		if (configured) return path.resolve(data, configured);
	} catch {
		// No launcher configuration: the default layout applies.
	}
	return path.join(data, "instances");
}

export async function listPrismInstances(directory: string): Promise<PrismInstance[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const instances: PrismInstance[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const instanceDirectory = path.join(directory, entry.name);
		const configFile = path.join(instanceDirectory, "instance.cfg");
		if (!existsSync(configFile)) continue;
		const config = readIni(await readFile(configFile, "utf8"));
		const minecraftDirectory = [".minecraft", "minecraft"].map((name) => path.join(instanceDirectory, name)).find((candidate) => existsSync(candidate));
		instances.push({ id: entry.name, name: config.name || entry.name, directory: instanceDirectory, minecraftDirectory });
	}
	return instances.sort((left, right) => left.name.localeCompare(right.name));
}

export async function scanLocalJars(minecraftDirectory: string): Promise<ScannedJar[]> {
	const jars: ScannedJar[] = [];
	for (const folder of MOD_FOLDERS) {
		const absolute = path.join(minecraftDirectory, ...folder.split("/"));
		if (!existsSync(absolute)) continue;
		for (const entry of await readdir(absolute, { withFileTypes: true })) {
			if (!entry.isFile() || !/\.jar$/i.test(entry.name)) continue;
			let content: Buffer | undefined;
			try {
				content = await readZipEntry(path.join(absolute, entry.name), "mcmod.info", 256 * 1024);
			} catch {
				content = undefined;
			}
			jars.push({ relativePath: `${folder}/${entry.name}`, mods: content ? parseModInfo(content.toString("utf8")) : [] });
		}
	}
	return jars;
}

export async function inspectLocal(minecraftDirectory: string, modId: string): Promise<LocalInspection> {
	assertSafeModId(modId);
	const match = matchMod(await scanLocalJars(minecraftDirectory), modId);
	const backups = await readLocalBackups(minecraftDirectory, modId);
	if (match.status === "absent") return { match, backups, state: { status: "absent" } };
	if (match.status === "ambiguous") return { match, backups, state: { status: "ambiguous", files: match.files } };
	const relativePath = match.jar.relativePath;
	const current: InstalledMod = {
		relativePath,
		fileName: path.posix.basename(relativePath),
		version: match.version,
		sha256: await fileSha256(localPath(minecraftDirectory, relativePath)),
	};
	const source = restoreSource(backups, current.sha256);
	return { match, current, backups, state: { status: "ready", current, restore: source && { backupId: source.id, fileName: path.posix.basename(source.record.originalFile) } } };
}

export async function readLocalBackups(minecraftDirectory: string, modId: string): Promise<ModBackup[]> {
	const directory = path.join(minecraftDirectory, BACKUP_DIRECTORY, assertSafeModId(modId));
	if (!existsSync(directory)) return [];
	const backups: ModBackup[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (!entry.isDirectory() || !isBackupId(entry.name)) continue;
		try {
			const record = parseBackupRecord(await readFile(path.join(directory, entry.name, BACKUP_RECORD), "utf8"));
			if (record.modId === modId) backups.push({ id: entry.name, record });
		} catch {
			// A damaged record can neither be restored nor break the chain.
		}
	}
	return sortBackups(backups);
}

/**
 * Moves the original into a backup folder outside `mods/`, then places the new JAR under
 * its own name. A locked original (the game is running) stops everything before a change.
 */
export async function replaceLocal(minecraftDirectory: string, jar: ModJar, inspection: LocalInspection, now = new Date()): Promise<{ installedFile: string; backupPath: string }> {
	const current = requireCurrent(inspection);
	if (current.sha256 === jar.sha256) throw new Error(`${current.fileName} is already this exact JAR`);
	const originalPath = localPath(minecraftDirectory, current.relativePath);
	const installedFile = `${path.posix.dirname(current.relativePath)}/${assertJarFileName(jar.fileName)}`;
	const installedPath = localPath(minecraftDirectory, installedFile);
	if (installedFile !== current.relativePath && existsSync(installedPath)) throw new Error(`${installedFile} already exists and is not the mod being replaced`);

	const modDirectory = path.join(minecraftDirectory, BACKUP_DIRECTORY, jar.modId);
	const backupPath = path.join(modDirectory, newBackupId(now));
	const incoming = path.join(minecraftDirectory, BACKUP_DIRECTORY, `.incoming-${randomUUID()}.jar`);
	await mkdir(backupPath, { recursive: true });
	try {
		await copyFile(jar.path, incoming);
		if ((await fileSha256(incoming)) !== jar.sha256) throw new Error("The copied JAR does not match the selected file");
		const backupFile = path.join(backupPath, current.fileName);
		await moveOrExplainLock(originalPath, backupFile);
		try {
			await rename(incoming, installedPath);
		} catch (error) {
			await rename(backupFile, originalPath);
			throw error;
		}
	} catch (error) {
		await rm(incoming, { force: true });
		await rm(backupPath, { recursive: true, force: true });
		throw error;
	}

	const record: ModBackupRecord = {
		version: 1,
		modId: jar.modId,
		originalFile: current.relativePath,
		originalSha256: current.sha256,
		installedFile,
		installedSha256: jar.sha256,
		createdAt: now.toISOString(),
	};
	await writeFile(path.join(backupPath, BACKUP_RECORD), `${JSON.stringify(record, null, 2)}\n`, "utf8");
	for (const stale of backupsToPrune(await readLocalBackups(minecraftDirectory, jar.modId))) {
		await rm(path.join(modDirectory, stale.id), { recursive: true, force: true });
	}
	return { installedFile, backupPath };
}

/** Puts the original of the latest chain back and removes the JAR the app installed. */
export async function restoreLocal(minecraftDirectory: string, modId: string, inspection: LocalInspection): Promise<{ installedFile: string }> {
	const current = requireCurrent(inspection);
	const source = restoreSource(inspection.backups, current.sha256);
	if (!source) throw new Error(`${current.fileName} was not installed by this app; nothing to restore`);
	const currentPath = localPath(minecraftDirectory, current.relativePath);
	const targetFile = source.record.originalFile;
	const targetPath = localPath(minecraftDirectory, targetFile);
	if (targetFile !== current.relativePath && existsSync(targetPath)) throw new Error(`${targetFile} already exists`);
	const backupFile = path.join(minecraftDirectory, BACKUP_DIRECTORY, modId, source.id, path.posix.basename(targetFile));
	if ((await fileSha256(backupFile)) !== source.record.originalSha256) throw new Error(`The backup of ${targetFile} is damaged`);

	const removing = `${currentPath}.gtnh-removing`;
	const temporary = `${targetPath}.gtnh-restoring`;
	await moveOrExplainLock(currentPath, removing);
	try {
		await copyFile(backupFile, temporary);
		await rename(temporary, targetPath);
	} catch (error) {
		await rm(temporary, { force: true });
		await rename(removing, currentPath);
		throw error;
	}
	await unlink(removing);
	return { installedFile: targetFile };
}

function requireCurrent(inspection: LocalInspection): InstalledMod {
	if (inspection.state.status === "absent") throw new Error("The mod is not installed here");
	if (inspection.state.status === "ambiguous") throw new Error(`Several JARs provide this mod: ${inspection.state.files.join(", ")}`);
	if (!inspection.current) throw new Error("The mod could not be read here");
	return inspection.current;
}

async function moveOrExplainLock(from: string, to: string): Promise<void> {
	try {
		await rename(from, to);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EBUSY" || code === "EPERM" || code === "EACCES") throw new Error(`${path.basename(from)} is locked: close the game before replacing it`);
		throw error;
	}
}

function localPath(minecraftDirectory: string, relativePath: string): string {
	return path.join(minecraftDirectory, ...relativePath.split("/"));
}

function readIni(text: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*([^#;=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
		if (match) values[match[1]!] = match[2]!;
	}
	return values;
}
