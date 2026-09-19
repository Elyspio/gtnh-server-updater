import { stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  DeploymentExecuteRequest,
  DeploymentPreflightRequest,
  DeploymentPreflightResult,
  DeploymentProgress,
  DeploymentResult,
  RemoteDirectoryEntry,
  SshConnectionInput,
} from "@shared/deployment.types";
import { RemoteClient, quoteShell } from "../ssh/remote-client";
import {
  assertAbsoluteSafePath,
  assertDeletionConfirmed,
  assertEnoughSpace,
  assertHttpsUrl,
  assertSeparateTrees,
  calculateRequiredFreeBytes,
  inspectArchiveEntries,
} from "./deployment-policy";

type PreparedOperation = {
  request: DeploymentPreflightRequest;
  result: DeploymentPreflightResult;
  requestedDestinationPath: string;
};

export class DeploymentService {
  private readonly operations = new Map<string, PreparedOperation>();

  public constructor(private readonly emit: (progress: DeploymentProgress) => void) {}

  public async listRemoteDirectory(
    connection: SshConnectionInput,
    remotePath: string,
  ): Promise<RemoteDirectoryEntry[]> {
    assertAbsoluteSafePath(remotePath, "Remote directory", true);
    return await this.withClient(connection, async (client) => await client.listDirectory(remotePath));
  }

  public async preflight(request: DeploymentPreflightRequest): Promise<DeploymentPreflightResult> {
    const operationId = randomUUID();
    this.emitProgress(operationId, "connecting", "Connecting to the Linux server");
    try {
      return await this.withClient(request.connection, async (client) => {
        this.emitProgress(operationId, "checking-paths", "Checking tools, paths and permissions");
        await this.assertRequiredTools(client);

        const paths = await this.resolveAndValidatePaths(client, request);
        const temporaryArchivePath = `${paths.destinationParent}/.gtnh-updater-${operationId}.zip`;
        const availableBeforeTransfer = await this.getAvailableBytes(client, paths.destinationParent);

        let expectedCompressedBytes: number | undefined;
        if (request.source.type === "local") {
          const localStat = await stat(request.source.path);
          if (!localStat.isFile()) throw new Error("The selected local archive is not a file");
          expectedCompressedBytes = localStat.size;
          assertEnoughSpace(availableBeforeTransfer, expectedCompressedBytes);
          this.emitProgress(operationId, "transferring", "Uploading the archive with SFTP");
          await client.upload(request.source.path, temporaryArchivePath, (transferred, total) => {
            this.emit({ operationId, stage: "transferring", message: "Uploading the archive", transferredBytes: transferred, totalBytes: total });
          });
        } else {
          const url = assertHttpsUrl(request.source.url);
          this.emitProgress(operationId, "downloading", "Downloading the archive on the Linux server");
          await client.executeChecked([
            "set -eu",
            `curl --fail --silent --show-error --location --max-redirs 5 --proto '=https' --proto-redir '=https' --output ${quoteShell(temporaryArchivePath)} ${quoteShell(url.href)}`,
          ].join("\n"));
        }

        this.emitProgress(operationId, "validating-archive", "Validating ZIP integrity and entries");
        const archive = await this.inspectRemoteArchive(client, temporaryArchivePath);
        if (expectedCompressedBytes !== undefined && archive.compressedBytes !== expectedCompressedBytes) {
          throw new Error("Uploaded archive size does not match the local file");
        }

        this.emitProgress(operationId, "checking-space", "Checking extraction space");
        const availableFreeBytes = await this.getAvailableBytes(client, paths.destinationParent);
        const requiredFreeBytes = calculateRequiredFreeBytes(archive.uncompressedBytes);
        assertEnoughSpace(availableFreeBytes, requiredFreeBytes);

        const destinationPreview = paths.destinationEntries.slice(0, 50);
        const result: DeploymentPreflightResult = {
          operationId,
          resolvedOldServerPath: paths.resolvedOldServerPath,
          resolvedDestinationPath: paths.resolvedDestinationPath,
          temporaryArchivePath,
          compressedBytes: archive.compressedBytes,
          uncompressedBytes: archive.uncompressedBytes,
          requiredFreeBytes,
          availableFreeBytes,
          destinationExists: paths.destinationExists,
          destinationNonEmpty: paths.destinationEntries.length > 0,
          destinationPreview,
        };
        this.operations.set(operationId, {
          request,
          result,
          requestedDestinationPath: paths.requestedDestinationPath,
        });
        if (result.destinationNonEmpty) {
          this.emitProgress(operationId, "awaiting-confirmation", "Type the exact destination path to authorize deletion");
        }
        return result;
      });
    } catch (error) {
      this.emitProgress(operationId, "failed", getErrorMessage(error));
      throw error;
    }
  }

  public async execute(request: DeploymentExecuteRequest): Promise<DeploymentResult> {
    const operation = this.operations.get(request.operationId);
    if (!operation) throw new Error("Deployment operation was not found or has expired");
    const { result, requestedDestinationPath } = operation;
    assertDeletionConfirmed(result.destinationNonEmpty, result.resolvedDestinationPath, request.confirmationPath);

    return await this.withClient(operation.request.connection, async (client) => {
      try {
        this.emitProgress(request.operationId, "checking-paths", "Rechecking the destination before deletion");
        const currentPaths = await this.resolveAndValidatePaths(client, operation.request);
        if (currentPaths.resolvedOldServerPath !== result.resolvedOldServerPath
          || currentPaths.resolvedDestinationPath !== result.resolvedDestinationPath
          || currentPaths.destinationExists !== result.destinationExists
          || (currentPaths.destinationEntries.length > 0) !== result.destinationNonEmpty) {
          throw new Error("Remote paths changed after preflight; run preflight again");
        }

        if (currentPaths.destinationExists) {
          this.emitProgress(request.operationId, "removing-destination", "Removing the existing destination");
          await client.executeChecked(`rm -rf -- ${quoteShell(requestedDestinationPath)}`);
        }
        await client.executeChecked(`mkdir -p -- ${quoteShell(requestedDestinationPath)}`);

        this.emitProgress(request.operationId, "extracting", "Extracting the validated archive");
        const extraction = await client.execute(
          `unzip -q ${quoteShell(result.temporaryArchivePath)} -d ${quoteShell(requestedDestinationPath)}`,
        );
        if (extraction.exitCode !== 0) {
          const details = extraction.stderr.trim() || `unzip exited with ${String(extraction.exitCode)}`;
          throw new Error(details);
        }

        this.emitProgress(request.operationId, "cleaning-up", "Removing the temporary archive");
        await client.executeChecked(`rm -f -- ${quoteShell(result.temporaryArchivePath)}`);
        this.operations.delete(request.operationId);
        this.emitProgress(request.operationId, "completed", "Server archive deployed successfully");
        return {
          operationId: request.operationId,
          status: "completed",
          destinationPath: requestedDestinationPath,
          partialDestinationPreserved: false,
        };
      } catch (error) {
        const message = getErrorMessage(error);
        this.emitProgress(request.operationId, "failed", message);
        return {
          operationId: request.operationId,
          status: "failed",
          destinationPath: requestedDestinationPath,
          temporaryArchivePath: result.temporaryArchivePath,
          partialDestinationPreserved: true,
          error: message,
        };
      }
    });
  }

  private async resolveAndValidatePaths(client: RemoteClient, request: DeploymentPreflightRequest): Promise<{
    requestedDestinationPath: string;
    destinationParent: string;
    resolvedOldServerPath: string;
    resolvedDestinationPath: string;
    destinationExists: boolean;
    destinationEntries: RemoteDirectoryEntry[];
  }> {
    assertAbsoluteSafePath(request.oldServerPath, "Old server path");
    assertAbsoluteSafePath(request.destinationPath, "Destination path");
    const requestedDestinationPath = trimTrailingSlash(path.posix.normalize(request.destinationPath));
    const requestedOldPath = trimTrailingSlash(path.posix.normalize(request.oldServerPath));
    const destinationParentInput = path.posix.dirname(requestedDestinationPath);
    const destinationName = path.posix.basename(requestedDestinationPath);

    const resolvedOldServerPath = (await client.executeChecked(
      `test -d ${quoteShell(requestedOldPath)} && test -r ${quoteShell(requestedOldPath)} && test -x ${quoteShell(requestedOldPath)} && cd ${quoteShell(requestedOldPath)} && pwd -P`,
    )).trim();
    const destinationParent = (await client.executeChecked(
      `test -d ${quoteShell(destinationParentInput)} && test -w ${quoteShell(destinationParentInput)} && test -x ${quoteShell(destinationParentInput)} && cd ${quoteShell(destinationParentInput)} && pwd -P`,
    )).trim();
    const destinationExists = (await client.execute(`test -e ${quoteShell(requestedDestinationPath)}`)).exitCode === 0;
    if ((await client.execute(`test -L ${quoteShell(requestedDestinationPath)}`)).exitCode === 0) {
      throw new Error("Destination cannot be a symbolic link");
    }
    if (destinationExists && (await client.execute(`test -d ${quoteShell(requestedDestinationPath)}`)).exitCode !== 0) {
      throw new Error("Destination exists but is not a directory");
    }
    const resolvedDestinationPath = destinationExists
      ? (await client.executeChecked(`cd ${quoteShell(requestedDestinationPath)} && pwd -P`)).trim()
      : `${trimTrailingSlash(destinationParent)}/${destinationName}`;

    assertAbsoluteSafePath(resolvedOldServerPath, "Resolved old server path");
    assertAbsoluteSafePath(resolvedDestinationPath, "Resolved destination path");
    assertSeparateTrees(resolvedOldServerPath, resolvedDestinationPath);

    const destinationEntries = destinationExists
      ? await client.listDirectory(requestedDestinationPath)
      : [];

    return { requestedDestinationPath, destinationParent, resolvedOldServerPath, resolvedDestinationPath, destinationExists, destinationEntries };
  }

  private async inspectRemoteArchive(client: RemoteClient, archivePath: string): Promise<{
    compressedBytes: number;
    uncompressedBytes: number;
  }> {
    await client.executeChecked(`unzip -tqq ${quoteShell(archivePath)}`);
    const entries = (await client.executeChecked(`unzip -Z1 ${quoteShell(archivePath)}`))
      .split(/\r?\n/)
      .filter(Boolean);
    const entryKinds = (await client.executeChecked(
      `unzip -Z -l ${quoteShell(archivePath)} | awk 'substr($1,1,1) ~ /^[-dlcbps]$/ {print substr($1,1,1)}'`,
    )).split(/\r?\n/).filter(Boolean);
    inspectArchiveEntries(entries, entryKinds);

    const compressedBytes = Number((await client.executeChecked(`stat -c %s ${quoteShell(archivePath)}`)).trim());
    const uncompressedBytes = Number((await client.executeChecked(
      `unzip -l ${quoteShell(archivePath)} | tail -n 1 | awk '{print $1}'`,
    )).trim());
    if (!Number.isSafeInteger(compressedBytes) || compressedBytes <= 0) throw new Error("Invalid ZIP file size");
    if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes <= 0) throw new Error("Invalid uncompressed ZIP size");
    return { compressedBytes, uncompressedBytes };
  }

  private async assertRequiredTools(client: RemoteClient): Promise<void> {
    const missing = (await client.executeChecked(
      `for tool in sh curl unzip; do command -v "$tool" >/dev/null 2>&1 || printf '%s\\n' "$tool"; done`,
    )).trim();
    if (missing) throw new Error(`Missing required Linux tools: ${missing.split(/\s+/).join(", ")}`);
  }

  private async getAvailableBytes(client: RemoteClient, remotePath: string): Promise<number> {
    const blocks = Number((await client.executeChecked(
      `df -Pk ${quoteShell(remotePath)} | awk 'END {print $4}'`,
    )).trim());
    if (!Number.isSafeInteger(blocks) || blocks < 0) throw new Error("Unable to determine available disk space");
    return blocks * 1024;
  }

  private async withClient<T>(connection: SshConnectionInput, action: (client: RemoteClient) => Promise<T>): Promise<T> {
    const client = new RemoteClient(connection);
    try {
      await client.connect();
      return await action(client);
    } finally {
      client.close();
    }
  }

  private emitProgress(operationId: string, stage: DeploymentProgress["stage"], message: string): void {
    this.emit({ operationId, stage, message });
  }
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
