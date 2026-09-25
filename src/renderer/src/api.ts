import type { SshProfileSaveRequest, TrustHostRequest } from "@shared/connection.types";
import type {
  DeploymentExecuteRequest,
  DeploymentPreflightRequest,
  DeploymentProgress,
  SshConnectionInput,
} from "@shared/deployment.types";
import type { MergeApplyRequest, MergeFileRequest, MergePrepareRequest, MergeProgress } from "@shared/merge.types";
import type { MigrationExecuteRequest, MigrationPrepareRequest, MigrationProgress } from "@shared/migration.types";
import type { UpdateStatus } from "@shared/update.types";

const bridge = (): Window["gtnh"] => window.gtnh;

/** Typed business calls over the contract bridge; the renderer has no other privileged access. */
export const api = {
  selectArchive: () => bridge().invoke("dialog:archive"),
  selectPrivateKey: () => bridge().invoke("dialog:private-key"),
  listProfiles: () => bridge().invoke("profiles:list"),
  saveProfile: (request: SshProfileSaveRequest) => bridge().invoke("profiles:save", request),
  deleteProfile: (id: string) => bridge().invoke("profiles:delete", id),
  testConnection: (connection: SshConnectionInput) => bridge().invoke("ssh:test", connection),
  trustHost: (request: TrustHostRequest) => bridge().invoke("ssh:trust-host", request),
  killOrphan: (connection: SshConnectionInput, id: string, pid: number) => bridge().invoke("ssh:kill-orphan", connection, id, pid),
  listReleases: () => bridge().invoke("releases:list"),
  latestVersions: () => bridge().invoke("releases:latest"),
  listRemoteDirectory: (connection: SshConnectionInput, path: string) => bridge().invoke("remote:list", connection, path),
  createRemoteDirectory: (connection: SshConnectionInput, parent: string, name: string) => bridge().invoke("remote:mkdir", connection, parent, name),
  preflight: (request: DeploymentPreflightRequest) => bridge().invoke("deployment:preflight", request),
  execute: (request: DeploymentExecuteRequest) => bridge().invoke("deployment:execute", request),
  prepareMerge: (request: MergePrepareRequest) => bridge().invoke("merge:prepare", request),
  loadMergeFile: (request: MergeFileRequest) => bridge().invoke("merge:load-file", request),
  applyMerge: (request: MergeApplyRequest) => bridge().invoke("merge:apply", request),
  discardMerge: (operationId: string) => bridge().invoke("merge:discard", operationId),
  prepareMigration: (request: MigrationPrepareRequest) => bridge().invoke("migration:prepare", request),
  executeMigration: (request: MigrationExecuteRequest) => bridge().invoke("migration:execute", request),
  cancelOperation: () => bridge().invoke("operation:cancel"),
  openLogs: () => bridge().invoke("app:open-logs"),
  saveReport: (markdown: string, fileName: string) => bridge().invoke("report:save", markdown, fileName),
  installUpdate: () => bridge().invoke("update:install"),
  onProgress: (listener: (progress: DeploymentProgress) => void) => bridge().on("deployment:progress", listener),
  onMergeProgress: (listener: (progress: MergeProgress) => void) => bridge().on("merge:progress", listener),
  onMigrationProgress: (listener: (progress: MigrationProgress) => void) => bridge().on("migration:progress", listener),
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => bridge().on("update:status", listener),
};

/** Electron prefixes errors crossing IPC; keep the message the main process produced. */
export function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
