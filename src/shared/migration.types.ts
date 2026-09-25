import type { SshConnectionInput } from "./deployment.types";

export type MigrationPrepareRequest = {
	connection: SshConnectionInput;
	oldServerPath: string;
	newServerPath: string;
	oldServerStoppedConfirmed: boolean;
};

export type MigrationItem = {
	/** Path relative to both server roots. */
	path: string;
	role: "world" | "world-data";
	files: number;
	bytes: number;
	existsInNewServer: boolean;
};

export type MigrationPrepareResult = {
	operationId: string;
	resolvedOldServerPath: string;
	resolvedNewServerPath: string;
	worldName: string;
	/** Present when the new server.properties uses another level-name that will be rewritten. */
	levelNameChange?: { from: string; to: string };
	items: MigrationItem[];
	missingDataPaths: string[];
	ignoredWorlds: string[];
	dataListWarning?: string;
	requiredFreeBytes: number;
	availableFreeBytes: number;
	/** Exact path to type when existing targets in the new server will be replaced. */
	replacementConfirmationPath?: string;
};

export type MigrationExecuteRequest = {
	operationId: string;
	confirmationPath?: string;
};

export type MigrationResult = {
	operationId: string;
	status: "completed" | "failed";
	copiedPaths: string[];
	levelNameRewritten: boolean;
	failedPath?: string;
	partialPath?: string;
	error?: string;
};

export type MigrationStage = "connecting" | "checking" | "copying" | "verifying" | "updating-properties" | "completed" | "failed";

export type MigrationProgress = {
	operationId: string;
	stage: MigrationStage;
	message: string;
	transferredBytes?: number;
	totalBytes?: number;
};
