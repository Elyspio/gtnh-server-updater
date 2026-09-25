import { z } from "zod";
import type {
  ConnectionTestResult,
  SshProfile,
  SshProfileList,
  SshProfileSaveRequest,
  TrustHostRequest,
} from "./connection.types";
import type {
  ArchiveSource,
  DeploymentExecuteRequest,
  DeploymentPreflightRequest,
  DeploymentPreflightResult,
  DeploymentProgress,
  DeploymentResult,
  RemoteDirectoryEntry,
  SshConnectionInput,
} from "./deployment.types";
import type { EventChannel, InvokeChannel } from "./ipc.channels";
import type {
  MergeApplyRequest,
  MergeApplyResult,
  MergeDecision,
  MergeDocument,
  MergeFileRequest,
  MergePrepareRequest,
  MergePrepareResult,
  MergeProgress,
} from "./merge.types";
import type {
  MigrationExecuteRequest,
  MigrationPrepareRequest,
  MigrationPrepareResult,
  MigrationProgress,
  MigrationResult,
} from "./migration.types";
import type { LatestVersions, ReleaseSummary } from "./releases.types";
import type { UpdateStatus } from "./update.types";

const MAX_PATH = 4096;
const MAX_TEXT = 256;

const text = z.string().max(MAX_TEXT);
/** Every path the user provides is trimmed here: a pasted trailing space is never part of it. */
const localPath = z.string().trim().min(1).max(MAX_PATH);
/** Absolute Linux paths; the services still resolve and check them on the server. */
const remotePath = z.string().trim().min(1).max(MAX_PATH).startsWith("/").refine((value) => !value.includes("\0"), "Invalid path");
const operationId = z.uuid();
const port = z.number().int().min(1).max(65_535);

export const connectionSchema: z.ZodType<SshConnectionInput> = z.object({
  host: z.string().trim().min(1).max(MAX_TEXT),
  port,
  username: z.string().trim().min(1).max(MAX_TEXT),
  privateKeyPath: localPath,
  passphrase: z.string().max(1024).optional(),
  profileId: z.uuid().optional(),
});

const archiveSourceSchema: z.ZodType<ArchiveSource> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local"), path: localPath }),
  z.object({ type: z.literal("url"), url: z.string().trim().min(1).max(MAX_PATH) }),
]);

const profileSaveSchema: z.ZodType<SshProfileSaveRequest> = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(MAX_TEXT),
  host: z.string().trim().min(1).max(MAX_TEXT),
  port,
  username: z.string().trim().min(1).max(MAX_TEXT),
  privateKeyPath: z.string().trim().max(MAX_PATH),
  oldServerPath: z.string().trim().max(MAX_PATH),
  newServerPath: z.string().trim().max(MAX_PATH),
  passphrase: z.string().max(1024).optional(),
  rememberPassphrase: z.boolean(),
});

const trustHostSchema: z.ZodType<TrustHostRequest> = z.object({
  host: z.string().min(1).max(MAX_TEXT),
  port,
  fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
});

const preflightSchema: z.ZodType<DeploymentPreflightRequest> = z.object({
  connection: connectionSchema,
  source: archiveSourceSchema,
  oldServerPath: remotePath,
  destinationPath: remotePath,
});

const deploymentExecuteSchema: z.ZodType<DeploymentExecuteRequest> = z.object({
  operationId,
  confirmationPath: z.string().max(MAX_PATH).optional(),
});

const mergePrepareSchema: z.ZodType<MergePrepareRequest> = z.object({
  connection: connectionSchema,
  baseSource: archiveSourceSchema,
  oldServerPath: remotePath,
  newServerPath: remotePath,
  extraExclusions: z.array(text).max(200),
});

const mergeFileSchema: z.ZodType<MergeFileRequest> = z.object({ operationId, path: z.string().min(1).max(MAX_PATH) });

const decisionSchema: z.ZodType<MergeDecision> = z.discriminatedUnion("action", [
  z.object({ path: z.string().min(1).max(MAX_PATH), action: z.literal("keep-new") }),
  z.object({ path: z.string().min(1).max(MAX_PATH), action: z.literal("take-old") }),
  z.object({ path: z.string().min(1).max(MAX_PATH), action: z.literal("write"), lines: z.array(z.string().max(1_000_000)).max(200_000) }),
]);

const mergeApplySchema: z.ZodType<MergeApplyRequest> = z.object({
  operationId,
  baseMismatchAcknowledged: z.boolean(),
  decisions: z.array(decisionSchema).max(100_000),
});

const migrationPrepareSchema: z.ZodType<MigrationPrepareRequest> = z.object({
  connection: connectionSchema,
  oldServerPath: remotePath,
  newServerPath: remotePath,
  oldServerStoppedConfirmed: z.boolean(),
});

const migrationExecuteSchema: z.ZodType<MigrationExecuteRequest> = z.object({
  operationId,
  confirmationPath: z.string().max(MAX_PATH).optional(),
});

/** Argument schemas, validated by the main process for every call. */
export const ipcArguments = {
  "dialog:archive": z.tuple([]),
  "dialog:private-key": z.tuple([]),
  "profiles:list": z.tuple([]),
  "profiles:save": z.tuple([profileSaveSchema]),
  "profiles:delete": z.tuple([z.uuid()]),
  "ssh:test": z.tuple([connectionSchema]),
  "ssh:trust-host": z.tuple([trustHostSchema]),
  "ssh:kill-orphan": z.tuple([connectionSchema, z.uuid(), z.number().int().min(2)]),
  "releases:list": z.tuple([]),
  "releases:latest": z.tuple([]),
  "remote:list": z.tuple([connectionSchema, remotePath]),
  "remote:mkdir": z.tuple([connectionSchema, remotePath, z.string().trim().min(1).max(255).regex(/^[^/\0]+$/).refine((name) => name !== "." && name !== "..", "Invalid folder name")]),
  "deployment:preflight": z.tuple([preflightSchema]),
  "deployment:execute": z.tuple([deploymentExecuteSchema]),
  "merge:prepare": z.tuple([mergePrepareSchema]),
  "merge:load-file": z.tuple([mergeFileSchema]),
  "merge:apply": z.tuple([mergeApplySchema]),
  "merge:discard": z.tuple([operationId]),
  "migration:prepare": z.tuple([migrationPrepareSchema]),
  "migration:execute": z.tuple([migrationExecuteSchema]),
  "operation:cancel": z.tuple([]),
  "app:open-logs": z.tuple([]),
  "report:save": z.tuple([z.string().max(5_000_000), z.string().min(1).max(MAX_TEXT)]),
  "update:install": z.tuple([]),
} satisfies Record<InvokeChannel, z.ZodTuple>;

export type IpcResults = {
  "dialog:archive": string | null;
  "dialog:private-key": string | null;
  "profiles:list": SshProfileList;
  "profiles:save": SshProfile;
  "profiles:delete": void;
  "ssh:test": ConnectionTestResult;
  "ssh:trust-host": void;
  "ssh:kill-orphan": void;
  "releases:list": ReleaseSummary[];
  "releases:latest": LatestVersions;
  "remote:list": RemoteDirectoryEntry[];
  "remote:mkdir": string;
  "deployment:preflight": DeploymentPreflightResult;
  "deployment:execute": DeploymentResult;
  "merge:prepare": MergePrepareResult;
  "merge:load-file": MergeDocument;
  "merge:apply": MergeApplyResult;
  "merge:discard": void;
  "migration:prepare": MigrationPrepareResult;
  "migration:execute": MigrationResult;
  "operation:cancel": boolean;
  "app:open-logs": void;
  /** Saved file path, or null when the dialog was cancelled. */
  "report:save": string | null;
  "update:install": void;
};

export type IpcEvents = {
  "deployment:progress": DeploymentProgress;
  "merge:progress": MergeProgress;
  "migration:progress": MigrationProgress;
  "update:status": UpdateStatus;
};

export type IpcArguments<C extends InvokeChannel> = z.infer<(typeof ipcArguments)[C]>;

/** Implemented in full by the main process: a missing or mistyped handler fails compilation. */
export type IpcHandlers = { [C in InvokeChannel]: (...args: IpcArguments<C>) => Promise<IpcResults[C]> | IpcResults[C] };

/** The only API the renderer sees on `window.gtnh`. */
export type GtnhBridge = {
  invoke<C extends InvokeChannel>(channel: C, ...args: IpcArguments<C>): Promise<IpcResults[C]>;
  on<E extends EventChannel>(channel: E, listener: (payload: IpcEvents[E]) => void): () => void;
};
