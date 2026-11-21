export type SshConnectionInput = {
	host: string;
	port: number;
	username: string;
	privateKeyPath: string;
	passphrase?: string;
	/** Saved profile whose stored passphrase the main process may use when none is typed. */
	profileId?: string;
};

export type ArchiveSource = { type: "local"; path: string } | { type: "url"; url: string };

export type DeploymentPreflightRequest = {
	connection: SshConnectionInput;
	source: ArchiveSource;
	oldServerPath: string;
	destinationPath: string;
};

export type RemoteDirectoryEntry = {
	name: string;
	path: string;
	type: "directory" | "file" | "symlink" | "other";
	size: number;
};

export type DeploymentPreflightResult = {
	operationId: string;
	resolvedOldServerPath: string;
	resolvedDestinationPath: string;
	temporaryArchivePath: string;
	compressedBytes: number;
	uncompressedBytes: number;
	requiredFreeBytes: number;
	availableFreeBytes: number;
	destinationExists: boolean;
	destinationNonEmpty: boolean;
	destinationPreview: RemoteDirectoryEntry[];
};

export type DeploymentExecuteRequest = {
	operationId: string;
	confirmationPath?: string;
};

export type DeploymentStage =
	| "connecting"
	| "checking-paths"
	| "transferring"
	| "downloading"
	| "validating-archive"
	| "checking-space"
	| "awaiting-confirmation"
	| "removing-destination"
	| "extracting"
	| "aligning-access"
	| "cleaning-up"
	| "completed"
	| "failed";

export type DeploymentProgress = {
	operationId?: string;
	stage: DeploymentStage;
	message: string;
	transferredBytes?: number;
	totalBytes?: number;
};

export type DeploymentResult = {
	operationId: string;
	status: "completed" | "failed";
	destinationPath: string;
	temporaryArchivePath?: string;
	partialDestinationPreserved: boolean;
	error?: string;
};
