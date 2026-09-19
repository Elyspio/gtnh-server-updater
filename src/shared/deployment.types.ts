export type SshConnectionInput = {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  passphrase?: string;
};

export type ArchiveSource =
  | { type: "local"; path: string }
  | { type: "url"; url: string };

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

export type GtnhApi = {
  selectArchive(): Promise<string | null>;
  selectPrivateKey(): Promise<string | null>;
  listRemoteDirectory(connection: SshConnectionInput, path: string): Promise<RemoteDirectoryEntry[]>;
  preflight(request: DeploymentPreflightRequest): Promise<DeploymentPreflightResult>;
  execute(request: DeploymentExecuteRequest): Promise<DeploymentResult>;
  onProgress(listener: (progress: DeploymentProgress) => void): () => void;
};
