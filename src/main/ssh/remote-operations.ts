import { stat } from "node:fs/promises";
import path from "node:path";
import type { ArchiveSource, SshConnectionInput } from "@shared/deployment.types";
import { assertAbsoluteSafePath, assertEnoughSpace, assertHttpsUrl, inspectArchiveEntries } from "../deployment/deployment-policy";
import { log } from "../logger";
import { RemoteClient, quoteShell } from "./remote-client";

export const CANCELLED_MESSAGE = "Cancelled by the user";

/**
 * Opens a connection for one action. Aborting the signal tears the connection down at once,
 * which also terminates tracked remote commands.
 */
export async function withClient<T>(
  connection: SshConnectionInput,
  action: (client: RemoteClient) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);
  const client = new RemoteClient(connection);
  const onAbort = (): void => client.destroy();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await client.connect();
    return await action(client);
  } catch (error) {
    if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    client.close();
  }
}

/** Removes app temporaries on a fresh connection, after a failure or a cancellation. */
export async function removeRemoteTemporaries(connection: SshConnectionInput, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await withClient(connection, async (client) => {
      await client.executeChecked(`rm -rf -- ${paths.map(quoteShell).join(" ")}`);
    });
  } catch (error) {
    log("error", `Temporary cleanup failed for ${paths.join(", ")}: ${getErrorMessage(error)}`);
  }
}

export async function assertRequiredTools(client: RemoteClient, tools: readonly string[]): Promise<void> {
  const missing = (await client.executeChecked(
    `for tool in ${tools.join(" ")}; do command -v "$tool" >/dev/null 2>&1 || printf '%s\\n' "$tool"; done`,
  )).trim();
  if (missing) throw new Error(`Missing required Linux tools: ${missing.split(/\s+/).join(", ")}`);
}

export async function getAvailableBytes(client: RemoteClient, remotePath: string): Promise<number> {
  const blocks = Number((await client.executeChecked(
    `df -Pk ${quoteShell(remotePath)} | awk 'END {print $4}'`,
  )).trim());
  if (!Number.isSafeInteger(blocks) || blocks < 0) throw new Error("Unable to determine available disk space");
  return blocks * 1024;
}

export type ArchiveTransferEvents = {
  onUploadStart(): void;
  onUploadProgress(transferred: number, total: number): void;
  onDownloadStart(): void;
};

/**
 * Places the archive at `remoteArchivePath`: SFTP upload for a local file, or a server-side
 * HTTPS-only download for a URL. Returns the local size when it is known.
 */
export async function fetchArchive(
  client: RemoteClient,
  source: ArchiveSource,
  remoteArchivePath: string,
  availableBytes: number,
  events: ArchiveTransferEvents,
): Promise<number | undefined> {
  if (source.type === "local") {
    const localStat = await stat(source.path);
    if (!localStat.isFile()) throw new Error("The selected local archive is not a file");
    assertEnoughSpace(availableBytes, localStat.size);
    events.onUploadStart();
    await client.upload(source.path, remoteArchivePath, events.onUploadProgress);
    return localStat.size;
  }

  const url = assertHttpsUrl(source.url);
  events.onDownloadStart();
  await client.executeTrackedChecked([
    "set -eu",
    `curl --fail --silent --show-error --location --max-redirs 5 --proto '=https' --proto-redir '=https' --output ${quoteShell(remoteArchivePath)} ${quoteShell(url.href)}`,
  ].join("\n"));
  return undefined;
}

export async function inspectRemoteArchive(client: RemoteClient, archivePath: string, expectedCompressedBytes?: number): Promise<{
  compressedBytes: number;
  uncompressedBytes: number;
}> {
  await client.executeTrackedChecked(`unzip -tqq ${quoteShell(archivePath)}`);
  const entries = (await client.executeChecked(`unzip -Z1 ${quoteShell(archivePath)}`))
    .split(/\r?\n/)
    .filter(Boolean);
  const entryKinds = (await client.executeChecked(
    `unzip -Z -l ${quoteShell(archivePath)} | awk 'substr($1,1,1) ~ /^[-dlcbps?]$/ {print substr($1,1,1)}'`,
  )).split(/\r?\n/).filter(Boolean);
  inspectArchiveEntries(entries, entryKinds);

  const compressedBytes = Number((await client.executeChecked(`stat -c %s ${quoteShell(archivePath)}`)).trim());
  const uncompressedBytes = Number((await client.executeChecked(
    `unzip -l ${quoteShell(archivePath)} | tail -n 1 | awk '{print $1}'`,
  )).trim());
  if (!Number.isSafeInteger(compressedBytes) || compressedBytes <= 0) throw new Error("Invalid ZIP file size");
  if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes <= 0) throw new Error("Invalid uncompressed ZIP size");
  if (expectedCompressedBytes !== undefined && compressedBytes !== expectedCompressedBytes) {
    throw new Error("Uploaded archive size does not match the local file");
  }
  return { compressedBytes, uncompressedBytes };
}

export async function resolveDirectory(client: RemoteClient, value: string, label: string, writable: boolean): Promise<string> {
  assertAbsoluteSafePath(value, label);
  const requested = path.posix.normalize(value).replace(/\/+$/, "");
  const access = writable ? "-w" : "-r";
  const resolved = (await client.execute(
    `test -d ${quoteShell(requested)} && test ${access} ${quoteShell(requested)} && test -x ${quoteShell(requested)} && cd ${quoteShell(requested)} && pwd -P`,
  ));
  if (resolved.exitCode !== 0) {
    throw new Error(`${label} must be an existing ${writable ? "writable" : "readable"} directory`);
  }
  const resolvedPath = resolved.stdout.trim();
  assertAbsoluteSafePath(resolvedPath, label);
  return resolvedPath;
}

/**
 * Resolves a writable directory, creating it when it is missing: the deployment step may have
 * been skipped, and a later step must not fail on a raw `cd` error from the remote shell.
 */
export async function ensureDirectory(client: RemoteClient, value: string, label: string): Promise<string> {
  assertAbsoluteSafePath(value, label);
  const requested = path.posix.normalize(value).replace(/\/+$/, "");
  if ((await client.execute(`test -e ${quoteShell(requested)}`)).exitCode !== 0) {
    // Only the last segment is created: a typed path must not leave a tree of empty directories.
    const parent = path.posix.dirname(requested);
    if ((await client.execute(`test -d ${quoteShell(parent)} && test -w ${quoteShell(parent)} && test -x ${quoteShell(parent)}`)).exitCode !== 0) {
      throw new Error(`${label} does not exist and ${parent} is not a writable directory`);
    }
    await client.executeChecked(`mkdir -- ${quoteShell(requested)}`);
  }
  return await resolveDirectory(client, requested, label, true);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
