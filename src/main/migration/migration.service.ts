import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  MigrationExecuteRequest,
  MigrationItem,
  MigrationPrepareRequest,
  MigrationPrepareResult,
  MigrationProgress,
  MigrationResult,
} from "@shared/migration.types";
import { quoteShell } from "../ssh/remote-client";
import {
  assertRequiredTools,
  getAvailableBytes,
  CANCELLED_MESSAGE,
  getErrorMessage,
  resolveDirectory,
  withClient,
} from "../ssh/remote-operations";
import {
  assertDeletionConfirmed,
  assertEnoughSpace,
  assertSeparateTrees,
  calculateRequiredFreeBytes,
} from "../deployment/deployment-policy";
import { assertSameStats, parseLevelName, replaceLevelName } from "./migration-policy";
import { assertNoSymbolicLinks, measureTree, readTextFile, resolveWorldData } from "./world-data";

type PreparedMigration = {
  request: MigrationPrepareRequest;
  result: MigrationPrepareResult;
};

export class MigrationService {
  private readonly operations = new Map<string, PreparedMigration>();

  public constructor(private readonly emit: (progress: MigrationProgress) => void) {}

  public async prepare(request: MigrationPrepareRequest, signal?: AbortSignal): Promise<MigrationPrepareResult> {
    if (!request.oldServerStoppedConfirmed) {
      throw new Error("Confirm that the old server is stopped before migrating the world");
    }
    const operationId = randomUUID();
    this.emitProgress(operationId, "connecting", "Connecting to the Linux server");
    try {
      return await withClient(request.connection, async (client) => {
        this.emitProgress(operationId, "checking", "Locating the world and its data");
        await assertRequiredTools(client, ["sh", "cp", "mv", "find", "awk", "df", "setsid"]);
        const resolvedOldServerPath = await resolveDirectory(client, request.oldServerPath, "Old server path", false);
        const resolvedNewServerPath = await resolveDirectory(client, request.newServerPath, "New server path", true);
        assertSeparateTrees(resolvedOldServerPath, resolvedNewServerPath);

        const worldData = await resolveWorldData(client, resolvedOldServerPath);
        const newProperties = await readTextFile(client, `${resolvedNewServerPath}/server.properties`);
        if (newProperties === undefined) throw new Error("The new server has no server.properties; deploy the archive first");
        const newLevelName = safeLevelName(newProperties);

        const items: MigrationItem[] = [];
        const paths: Array<[string, MigrationItem["role"]]> = [
          [worldData.worldName, "world"],
          ...worldData.dataPaths.map((dataPath): [string, MigrationItem["role"]] => [dataPath, "world-data"]),
        ];
        for (const [relativePath, role] of paths) {
          await assertNoSymbolicLinks(client, resolvedOldServerPath, relativePath);
          const stats = await measureTree(client, resolvedOldServerPath, relativePath);
          const existsInNewServer = (await client.execute(
            `test -e ${quoteShell(`${resolvedNewServerPath}/${relativePath}`)} || test -L ${quoteShell(`${resolvedNewServerPath}/${relativePath}`)}`,
          )).exitCode === 0;
          items.push({ path: relativePath, role, ...stats, existsInNewServer });
        }

        const requiredFreeBytes = calculateRequiredFreeBytes(items.reduce((total, item) => total + item.bytes, 0));
        const availableFreeBytes = await getAvailableBytes(client, resolvedNewServerPath);
        assertEnoughSpace(availableFreeBytes, requiredFreeBytes);

        const result: MigrationPrepareResult = {
          operationId,
          resolvedOldServerPath,
          resolvedNewServerPath,
          worldName: worldData.worldName,
          levelNameChange: newLevelName === worldData.worldName ? undefined : { from: newLevelName ?? "(missing)", to: worldData.worldName },
          items,
          missingDataPaths: worldData.missingDataPaths,
          ignoredWorlds: worldData.ignoredWorlds,
          dataListWarning: worldData.dataListWarning,
          requiredFreeBytes,
          availableFreeBytes,
          replacementConfirmationPath: items.some((item) => item.existsInNewServer)
            ? `${resolvedNewServerPath}/${worldData.worldName}`
            : undefined,
        };
        this.operations.set(operationId, { request, result });
        return result;
      }, signal);
    } catch (error) {
      this.emitProgress(operationId, "failed", getErrorMessage(error));
      throw error;
    }
  }

  public async execute(request: MigrationExecuteRequest, signal?: AbortSignal): Promise<MigrationResult> {
    const operation = this.operations.get(request.operationId);
    if (!operation) throw new Error("Migration operation was not found or has expired");
    const { result } = operation;
    if (result.replacementConfirmationPath) {
      assertDeletionConfirmed(true, result.replacementConfirmationPath, request.confirmationPath);
    }
    const { resolvedOldServerPath, resolvedNewServerPath } = result;
    const totalBytes = result.items.reduce((total, item) => total + item.bytes, 0);
    const copiedPaths: string[] = [];
    let copiedBytes = 0;
    let failedPath: string | undefined;
    let partialPath: string | undefined;
    let levelNameRewritten = false;

    try {
      return await withClient(operation.request.connection, async (client) => {
        for (const item of result.items) {
          failedPath = item.path;
          const source = `${resolvedOldServerPath}/${item.path}`;
          const target = `${resolvedNewServerPath}/${item.path}`;
          const temporary = `${target}.gtnh-migrate-${request.operationId}`;
          const temporaryRelative = `${item.path}.gtnh-migrate-${request.operationId}`;

          this.emit({ operationId: request.operationId, stage: "copying", message: `Copying ${item.path}`, transferredBytes: copiedBytes, totalBytes });
          await assertNoSymbolicLinks(client, resolvedOldServerPath, item.path);
          const sourceStats = await measureTree(client, resolvedOldServerPath, item.path);
          partialPath = temporary;
          await client.executeTrackedChecked(
            `mkdir -p -- ${quoteShell(path.posix.dirname(target))} && cp -a -- ${quoteShell(source)} ${quoteShell(temporary)}`,
          );

          this.emitProgress(request.operationId, "verifying", `Verifying ${item.path}`);
          assertSameStats(item.path, sourceStats, await measureTree(client, resolvedNewServerPath, temporaryRelative));
          partialPath = target;
          await client.executeTrackedChecked(
            `rm -rf -- ${quoteShell(target)} && mv -- ${quoteShell(temporary)} ${quoteShell(target)}`,
          );
          partialPath = undefined;
          copiedPaths.push(item.path);
          copiedBytes += sourceStats.bytes;
        }
        failedPath = undefined;

        if (result.levelNameChange) {
          failedPath = "server.properties";
          this.emitProgress(request.operationId, "updating-properties", `Setting level-name to ${result.worldName}`);
          const propertiesPath = `${resolvedNewServerPath}/server.properties`;
          const properties = await readTextFile(client, propertiesPath);
          if (properties === undefined) throw new Error("The new server.properties disappeared");
          const temporary = `${propertiesPath}.gtnh-migrate-${request.operationId}`;
          await client.writeFile(temporary, Buffer.from(replaceLevelName(properties, result.worldName), "utf8"));
          await client.executeChecked(
            `chmod --reference=${quoteShell(propertiesPath)} -- ${quoteShell(temporary)} && mv -f -- ${quoteShell(temporary)} ${quoteShell(propertiesPath)}`,
          );
          levelNameRewritten = true;
          failedPath = undefined;
        }

        this.operations.delete(request.operationId);
        this.emitProgress(request.operationId, "completed", "World and world data copied to the new server");
        return { operationId: request.operationId, status: "completed" as const, copiedPaths, levelNameRewritten };
      }, signal);
    } catch (error) {
      // Partial copies stay in place and are reported; the step is prepared again to retry.
      const message = signal?.aborted ? CANCELLED_MESSAGE : getErrorMessage(error);
      this.emitProgress(request.operationId, "failed", message);
      this.operations.delete(request.operationId);
      return {
        operationId: request.operationId,
        status: "failed",
        copiedPaths,
        levelNameRewritten,
        failedPath,
        partialPath,
        error: message,
      };
    }
  }

  private emitProgress(operationId: string, stage: MigrationProgress["stage"], message: string): void {
    this.emit({ operationId, stage, message });
  }
}

function safeLevelName(properties: string): string | undefined {
  try {
    return parseLevelName(properties);
  } catch {
    return undefined;
  }
}
