import type { SshConnectionInput } from "./deployment.types";

/** A local mod JAR identified by the single modid of its mcmod.info. */
export type ModJar = {
	path: string;
	fileName: string;
	modId: string;
	name?: string;
	version?: string;
	sizeBytes: number;
	/** Milliseconds since the epoch. */
	modifiedAt: number;
	sha256: string;
};

export type ModSource = { modId: string; folder: string; name?: string };

export type ModsSettings = {
	prismDirectory: string;
	/** True when the Prism directory is the detected default rather than a saved override. */
	prismDirectoryIsDefault: boolean;
	sources: ModSource[];
};

/** The JAR currently providing the modid in a target. */
export type InstalledMod = {
	/** Relative to the server or `.minecraft` directory, e.g. `mods/foo.jar`. */
	relativePath: string;
	fileName: string;
	version?: string;
	sha256: string;
};

/** What the app installed in place of an original, kept next to the original in its backup folder. */
export type ModBackupRecord = {
	version: 1;
	modId: string;
	originalFile: string;
	originalSha256: string;
	installedFile: string;
	installedSha256: string;
	createdAt: string;
};

export type ModBackup = { id: string; record: ModBackupRecord };

export type ModTargetState =
	| { status: "ready"; current: InstalledMod; restore?: { backupId: string; fileName: string } }
	| { status: "absent" }
	| { status: "ambiguous"; files: string[] }
	| { status: "running" }
	| { status: "error"; message: string };

export type ServerModState = {
	serviceName: string;
	serverPath: string;
	serviceState: string;
	state: ModTargetState;
};

export type PrismInstanceState = { id: string; name: string; directory: string; state: ModTargetState };

export type ModsServerTarget = { connection: SshConnectionInput; serviceName: string };

export type ModsInspectRequest = {
	modId: string;
	server?: ModsServerTarget;
	prismDirectory: string;
};

export type ModsInspectResult = {
	modId: string;
	server?: { state: ServerModState } | { error: string };
	instances: PrismInstanceState[];
	instancesError?: string;
};

export type ModsApplyRequest = {
	action: "replace" | "restore";
	modId: string;
	/** Required to replace; ignored to restore. */
	jarPath?: string;
	server?: ModsServerTarget & { restartConfirmed: boolean };
	prismDirectory: string;
	instanceIds: string[];
};

export type ModsTargetResult = {
	label: string;
	status: "completed" | "failed" | "skipped";
	message?: string;
	installedFile?: string;
	backupPath?: string;
};

export type ModsServerResult = ModsTargetResult & {
	/** Error lines from the crash report or the FML log after a failed start. */
	logExcerpt?: string;
	startedInMs?: number;
};

export type ModsApplyResult = {
	action: ModsApplyRequest["action"];
	modId: string;
	status: "completed" | "failed";
	server?: ModsServerResult;
	instances: Array<ModsTargetResult & { instanceId: string }>;
	durationMs: number;
};

export type ModsStage = "checking" | "uploading" | "stopping" | "replacing" | "starting" | "verifying" | "clients" | "completed" | "failed";

export type ModsProgress = { stage: ModsStage; message: string };

/** A mod replaced by the app that is still active in a server folder. */
export type ActiveCustomMod = { modId: string; installedFile: string; originalFile: string; createdAt: string };
