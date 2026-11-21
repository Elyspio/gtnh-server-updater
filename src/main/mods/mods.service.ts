import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SshConnectionInput } from "@shared/deployment.types";
import type {
	ActiveCustomMod,
	ModJar,
	ModsApplyRequest,
	ModsApplyResult,
	ModsInspectRequest,
	ModsInspectResult,
	ModsProgress,
	ModsServerResult,
	ModsServerTarget,
	ModsSettings,
	ModsStage,
	PrismInstanceState,
} from "@shared/mods.types";
import { log } from "../logger";
import { quoteShell, type RemoteClient } from "../ssh/remote-client";
import { CANCELLED_MESSAGE, getErrorMessage, resolveDirectory, withClient } from "../ssh/remote-operations";
import { preserveAccessScript } from "../ssh/server-access";
import { BACKUP_DIRECTORY, backupsToPrune, newBackupId, restoreSource } from "./backup-policy";
import { POLL_INTERVAL_MS, assessBoot, excerptScript, observationScript, parseObservation, type BootTracker } from "./boot-check";
import { isInstanceRunning, listJavaCommandLines } from "./java-processes";
import { inspectLocal, listModJars, listPrismInstances, readModJar, replaceLocal, restoreLocal, scanModJars } from "./local-mods";
import { assertJarFileName, assertSafeModId } from "./mod-info";
import type { ModsSettingsStore } from "./mods-settings-store";
import { findActiveCustomMods, inspectServer, readServerBackups, remoteSha256, writeBackupRecord, type ServerInspection } from "./server-mods";

export type ModsServiceDependencies = {
	javaCommandLines(): Promise<string[]>;
	sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
	now(): number;
};

const defaults: ModsServiceDependencies = {
	javaCommandLines: () => listJavaCommandLines(),
	sleep: abortableSleep,
	now: () => Date.now(),
};

/**
 * Replaces one mod by a local build, on the server of the profile (stop, replace, start,
 * verify) and then on the chosen Prism instances. Every action is a single, explicit run.
 */
export class ModsService {
	private readonly dependencies: ModsServiceDependencies;

	public constructor(
		private readonly emit: (progress: ModsProgress) => void,
		private readonly settings: ModsSettingsStore,
		dependencies: Partial<ModsServiceDependencies> = {}
	) {
		this.dependencies = { ...defaults, ...dependencies };
	}

	/** Reads a build folder and remembers it for every modid built there, the most recently built first. */
	public async readFolder(folder: string): Promise<{ modIds: string[]; settings: ModsSettings }> {
		const newest = new Map<string, ModJar>();
		for (const jar of await scanModJars(folder)) if (!newest.has(jar.modId)) newest.set(jar.modId, jar);
		if (newest.size === 0) throw new Error(`No mod JAR in ${folder}: a build folder holds JARs with a single modid in their mcmod.info`);
		let settings = this.settings.get();
		for (const jar of newest.values()) settings = await this.settings.rememberSource(jar.modId, folder, jar.name);
		return { modIds: [...newest.keys()], settings };
	}

	public async listSource(modId: string): Promise<ModJar[]> {
		const source = this.settings.source(assertSafeModId(modId));
		if (!source) throw new Error(`No remembered folder for ${modId}`);
		return await listModJars(source.folder, modId);
	}

	public async inspect(request: ModsInspectRequest, signal?: AbortSignal): Promise<ModsInspectResult> {
		const modId = assertSafeModId(request.modId);
		const result: ModsInspectResult = { modId, instances: [] };
		if (request.server) {
			const server = request.server;
			try {
				const inspection = await withClient(server.connection, async (client) => await inspectServer(client, server.serviceName, modId), signal);
				result.server = { state: { ...inspection.location, state: inspection.state } };
			} catch (error) {
				if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);
				result.server = { error: getErrorMessage(error) };
			}
		}
		try {
			result.instances = await this.inspectInstances(request.prismDirectory, modId);
		} catch (error) {
			result.instancesError = `Prism instances could not be read: ${getErrorMessage(error)}`;
		}
		return result;
	}

	public async apply(request: ModsApplyRequest, signal?: AbortSignal): Promise<ModsApplyResult> {
		const started = this.dependencies.now();
		const modId = assertSafeModId(request.modId);
		if (!request.server && request.instanceIds.length === 0) throw new Error("Choose the server, a Prism instance, or both");
		if (request.server && !request.server.restartConfirmed) throw new Error("Confirm that the server may be restarted");
		let jar: ModJar | undefined;
		if (request.action === "replace") {
			if (!request.jarPath) throw new Error("Choose the JAR to install");
			jar = await readModJar(request.jarPath);
			if (jar.modId !== modId) throw new Error(`${jar.fileName} provides ${jar.modId}, not ${modId}`);
		}

		let server: ModsServerResult | undefined;
		if (request.server) {
			server = await this.applyServer(request.server, modId, jar, signal);
		}
		const instances: ModsApplyResult["instances"] = [];
		if (server && server.status !== "completed") {
			for (const instanceId of request.instanceIds) {
				instances.push({ instanceId, label: instanceId, status: "skipped", message: "Skipped: the server change did not succeed" });
			}
		} else if (request.instanceIds.length > 0) {
			this.progress("clients", `Updating ${request.instanceIds.length} Prism instance(s)`);
			instances.push(...(await this.applyInstances(request, modId, jar)));
		}

		const status = (server?.status ?? "completed") === "completed" && instances.every((instance) => instance.status === "completed") ? "completed" : "failed";
		this.progress(status, status === "completed" ? "All targets updated" : "Some targets were not updated");
		return { action: request.action, modId, status, server, instances, durationMs: this.dependencies.now() - started };
	}

	public async activeCustomMods(connection: SshConnectionInput, serverPath: string, signal?: AbortSignal): Promise<ActiveCustomMod[]> {
		return await withClient(
			connection,
			async (client) => {
				const root = await resolveDirectory(client, serverPath, "Server path", false);
				return await findActiveCustomMods(client, root);
			},
			signal
		);
	}

	private async inspectInstances(prismDirectory: string, modId: string): Promise<PrismInstanceState[]> {
		const instances = await listPrismInstances(prismDirectory);
		const commandLines = await this.javaCommandLinesOrEmpty();
		const states: PrismInstanceState[] = [];
		for (const instance of instances) {
			const base = { id: instance.id, name: instance.name, directory: instance.directory };
			if (!instance.minecraftDirectory) {
				states.push({ ...base, state: { status: "absent" } });
			} else if (isInstanceRunning(instance.directory, commandLines)) {
				states.push({ ...base, state: { status: "running" } });
			} else {
				try {
					states.push({ ...base, state: (await inspectLocal(instance.minecraftDirectory, modId)).state });
				} catch (error) {
					states.push({ ...base, state: { status: "error", message: getErrorMessage(error) } });
				}
			}
		}
		return states;
	}

	private async applyInstances(request: ModsApplyRequest, modId: string, jar: ModJar | undefined): Promise<ModsApplyResult["instances"]> {
		const results: ModsApplyResult["instances"] = [];
		let instances: Awaited<ReturnType<typeof listPrismInstances>> = [];
		try {
			instances = await listPrismInstances(request.prismDirectory);
		} catch (error) {
			return request.instanceIds.map((instanceId) => ({ instanceId, label: instanceId, status: "failed" as const, message: getErrorMessage(error) }));
		}
		const commandLines = await this.javaCommandLinesOrEmpty();
		for (const instanceId of request.instanceIds) {
			const instance = instances.find((candidate) => candidate.id === instanceId);
			const label = instance?.name ?? instanceId;
			try {
				if (!instance?.minecraftDirectory) throw new Error("Instance not found");
				if (isInstanceRunning(instance.directory, commandLines)) throw new Error("The instance is running: close the game first");
				const inspection = await inspectLocal(instance.minecraftDirectory, modId);
				if (jar) {
					const { installedFile, backupPath } = await replaceLocal(instance.minecraftDirectory, jar, inspection);
					results.push({ instanceId, label, status: "completed", installedFile, backupPath });
				} else {
					const { installedFile } = await restoreLocal(instance.minecraftDirectory, modId, inspection);
					results.push({ instanceId, label, status: "completed", installedFile });
				}
				log("info", `Prism instance ${label}: ${request.action} ${modId} completed`);
			} catch (error) {
				log("error", `Prism instance ${label}: ${request.action} ${modId} failed: ${getErrorMessage(error)}`);
				results.push({ instanceId, label, status: "failed", message: getErrorMessage(error) });
			}
		}
		return results;
	}

	/**
	 * The stop-replace-start section is not cancellable: the connection is not tied to the
	 * signal, which is only checked before the stop and while waiting for the start.
	 */
	private async applyServer(target: ModsServerTarget, modId: string, jar: ModJar | undefined, signal?: AbortSignal): Promise<ModsServerResult> {
		const label = `Server (${target.serviceName} on ${target.connection.host})`;
		let stopped = false;
		try {
			return await withClient(target.connection, async (client) => {
				this.progress("checking", "Locating the service and the installed mod");
				const inspection = await inspectServer(client, target.serviceName, modId);
				const root = inspection.location.serverPath;
				const change = jar ? await this.prepareServerReplace(client, inspection, jar) : await this.prepareServerRestore(client, inspection, modId);
				if (signal?.aborted) {
					await change.discard();
					throw new Error(CANCELLED_MESSAGE);
				}

				this.progress("stopping", `Stopping ${target.serviceName} (the world is saved first)`);
				await client.executeTrackedChecked(`systemctl stop -- ${quoteShell(inspection.location.serviceName)}`);
				stopped = true;
				this.progress("replacing", jar ? `Installing ${jar.fileName}` : "Restoring the original JAR");
				let applied: { installedFile: string; backupPath?: string };
				try {
					applied = await change.apply();
				} catch (error) {
					await change.discard();
					await client.executeTrackedChecked(`systemctl start -- ${quoteShell(inspection.location.serviceName)}`);
					stopped = false;
					throw new Error(`${getErrorMessage(error)}. Nothing was changed; the server was started again with its previous JAR (start not verified).`);
				}

				const boot = await this.startAndVerify(client, root, inspection.location.serviceName, signal);
				stopped = false;
				if (boot.status === "started") {
					return { label, status: "completed", installedFile: applied.installedFile, backupPath: applied.backupPath, startedInMs: boot.elapsedMs };
				}
				return {
					label,
					status: "failed",
					installedFile: applied.installedFile,
					backupPath: applied.backupPath,
					message: boot.message,
					logExcerpt: boot.excerpt,
				};
			});
		} catch (error) {
			const message = getErrorMessage(error);
			log("error", `Server ${modId} ${jar ? "replace" : "restore"} failed: ${message}`);
			return { label, status: "failed", message: stopped ? `${message}. The service may still be stopped.` : message };
		}
	}

	private async prepareServerReplace(client: RemoteClient, inspection: ServerInspection, jar: ModJar): Promise<ServerChange> {
		const current = requireServerCurrent(inspection);
		if (current.sha256 === jar.sha256) throw new Error(`${current.fileName} is already this exact JAR`);
		const root = inspection.location.serverPath;
		const installedFile = `${path.posix.dirname(current.relativePath)}/${assertJarFileName(jar.fileName)}`;
		if (installedFile !== current.relativePath && (await client.execute(`test -e ${quoteShell(`${root}/${installedFile}`)}`)).exitCode === 0) {
			throw new Error(`${installedFile} already exists and is not the mod being replaced`);
		}
		const incoming = `${root}/${BACKUP_DIRECTORY}/.incoming-${randomUUID()}.jar`;
		await client.executeChecked(`mkdir -p -- ${quoteShell(`${root}/${BACKUP_DIRECTORY}`)}`);
		this.progress("uploading", `Uploading ${jar.fileName}`);
		await client.upload(jar.path, incoming, () => undefined);
		if ((await remoteSha256(client, incoming)) !== jar.sha256) {
			await client.execute(`rm -f -- ${quoteShell(incoming)}`);
			throw new Error("The uploaded JAR does not match the local file");
		}

		const now = new Date(this.dependencies.now());
		const backupPath = `${root}/${BACKUP_DIRECTORY}/${jar.modId}/${newBackupId(now)}`;
		const original = `${root}/${current.relativePath}`;
		const backupFile = `${backupPath}/${current.fileName}`;
		const installed = `${root}/${installedFile}`;
		return {
			discard: async () => {
				// The new JAR is removed only once it was moved into place; then the original comes back.
				await client.execute(
					[
						`[ -e ${quoteShell(incoming)} ] || [ ! -e ${quoteShell(backupFile)} ] || rm -f -- ${quoteShell(installed)}`,
						`[ -e ${quoteShell(original)} ] || [ ! -e ${quoteShell(backupFile)} ] || mv -- ${quoteShell(backupFile)} ${quoteShell(original)}`,
						`rm -rf -- ${quoteShell(incoming)} ${quoteShell(backupPath)}`,
					].join("\n")
				);
			},
			apply: async () => {
				await client.executeChecked(
					[
						"set -e",
						`mkdir -p -- ${quoteShell(backupPath)}`,
						`mv -- ${quoteShell(original)} ${quoteShell(backupFile)}`,
						`mv -- ${quoteShell(incoming)} ${quoteShell(installed)}`,
						preserveAccessScript(backupFile, installed),
					].join("\n")
				);
				await writeBackupRecord(client, backupPath, {
					version: 1,
					modId: jar.modId,
					originalFile: current.relativePath,
					originalSha256: current.sha256,
					installedFile,
					installedSha256: jar.sha256,
					createdAt: now.toISOString(),
				});
				const stale = backupsToPrune(await readServerBackups(client, root, jar.modId));
				if (stale.length > 0) {
					await client.executeChecked(`rm -rf -- ${stale.map((backup) => quoteShell(`${root}/${BACKUP_DIRECTORY}/${jar.modId}/${backup.id}`)).join(" ")}`);
				}
				return { installedFile, backupPath };
			},
		};
	}

	private async prepareServerRestore(client: RemoteClient, inspection: ServerInspection, modId: string): Promise<ServerChange> {
		const current = requireServerCurrent(inspection);
		const source = restoreSource(inspection.backups, current.sha256);
		if (!source) throw new Error(`${current.fileName} was not installed by this app; nothing to restore`);
		const root = inspection.location.serverPath;
		const target = `${root}/${source.record.originalFile}`;
		const currentPath = `${root}/${current.relativePath}`;
		if (source.record.originalFile !== current.relativePath && (await client.execute(`test -e ${quoteShell(target)}`)).exitCode === 0) {
			throw new Error(`${source.record.originalFile} already exists`);
		}
		const backupFile = `${root}/${BACKUP_DIRECTORY}/${modId}/${source.id}/${path.posix.basename(source.record.originalFile)}`;
		if ((await remoteSha256(client, backupFile)) !== source.record.originalSha256) throw new Error(`The backup of ${source.record.originalFile} is damaged`);
		const temporary = `${target}.gtnh-restoring`;
		return {
			discard: async () => {
				await client.execute(`rm -f -- ${quoteShell(temporary)}`);
			},
			apply: async () => {
				await client.executeChecked(
					[
						"set -e",
						`cp -p -- ${quoteShell(backupFile)} ${quoteShell(temporary)}`,
						`rm -f -- ${quoteShell(currentPath)}`,
						`mv -- ${quoteShell(temporary)} ${quoteShell(target)}`,
					].join("\n")
				);
				return { installedFile: source.record.originalFile };
			},
		};
	}

	private async startAndVerify(
		client: RemoteClient,
		root: string,
		serviceName: string,
		signal?: AbortSignal
	): Promise<{ status: "started"; elapsedMs: number } | { status: "failed"; message: string; excerpt?: string }> {
		const observe = async () => parseObservation(await client.executeChecked(observationScript(root, serviceName)));
		const tracker: BootTracker = { baseline: await observe(), startedAt: this.dependencies.now() };
		this.progress("starting", `Starting ${serviceName}`);
		await client.executeTrackedChecked(`systemctl start -- ${quoteShell(serviceName)}`);
		for (;;) {
			try {
				await this.dependencies.sleep(POLL_INTERVAL_MS, signal);
			} catch {
				return { status: "failed", message: "Cancelled while waiting: the server keeps running, its start was not verified" };
			}
			const elapsed = this.dependencies.now() - tracker.startedAt;
			const verdict = assessBoot(tracker, await observe(), this.dependencies.now());
			if (verdict.status === "started") {
				this.progress("verifying", `Server started in ${Math.round(elapsed / 1000)} s`);
				return { status: "started", elapsedMs: elapsed };
			}
			if (verdict.status === "failed") {
				const excerpt = (await client.execute(excerptScript(root, verdict.crashReport))).stdout.trim() || undefined;
				this.progress("stopping", `${verdict.reason}; stopping ${serviceName}`);
				await client.executeTrackedChecked(`systemctl stop -- ${quoteShell(serviceName)}`);
				return { status: "failed", message: `${verdict.reason}. The service was stopped; use Restore original or install another JAR.`, excerpt };
			}
			this.progress("verifying", `Waiting for the server to start (${Math.round(elapsed / 1000)} s)`);
		}
	}

	private async javaCommandLinesOrEmpty(): Promise<string[]> {
		try {
			return await this.dependencies.javaCommandLines();
		} catch (error) {
			log("error", `Running Java processes could not be listed: ${getErrorMessage(error)}`);
			return [];
		}
	}

	private progress(stage: ModsStage, message: string): void {
		this.emit({ stage, message });
	}
}

type ServerChange = { apply(): Promise<{ installedFile: string; backupPath?: string }>; discard(): Promise<void> };

function requireServerCurrent(inspection: ServerInspection): NonNullable<ServerInspection["current"]> {
	if (inspection.state.status === "absent") throw new Error("The mod is not installed on the server");
	if (inspection.state.status === "ambiguous") throw new Error(`Several JARs provide this mod on the server: ${inspection.state.files.join(", ")}`);
	if (!inspection.current) throw new Error("The installed mod could not be read on the server");
	return inspection.current;
}

export async function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, milliseconds);
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new Error(CANCELLED_MESSAGE));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
