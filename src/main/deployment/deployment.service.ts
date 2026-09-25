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
	CANCELLED_MESSAGE,
	assertRequiredTools,
	fetchArchive,
	getAvailableBytes,
	getErrorMessage,
	inspectRemoteArchive,
	removeRemoteTemporaries,
	resolveDirectory,
	withClient,
} from "../ssh/remote-operations";
import { assertAbsoluteSafePath, assertDeletionConfirmed, assertEnoughSpace, assertSeparateTrees, calculateRequiredFreeBytes } from "./deployment-policy";

const REQUIRED_TOOLS = ["sh", "curl", "unzip", "setsid"];

type PreparedOperation = {
	request: DeploymentPreflightRequest;
	result: DeploymentPreflightResult;
	requestedDestinationPath: string;
};

export class DeploymentService {
	private readonly operations = new Map<string, PreparedOperation>();

	public constructor(private readonly emit: (progress: DeploymentProgress) => void) {}

	public async listRemoteDirectory(connection: SshConnectionInput, remotePath: string): Promise<RemoteDirectoryEntry[]> {
		assertAbsoluteSafePath(remotePath, "Remote directory", true);
		return await withClient(connection, async (client) => await client.listDirectory(remotePath));
	}

	/** Creates one folder in an existing writable directory; never creates parents. */
	public async createRemoteDirectory(connection: SshConnectionInput, parentPath: string, name: string): Promise<string> {
		assertAbsoluteSafePath(parentPath, "Parent directory", true);
		if (!name || name === "." || name === ".." || /[/\0]/.test(name)) throw new Error("Invalid folder name");
		return await withClient(connection, async (client) => {
			const parent = await resolveDirectory(client, parentPath, "Parent directory", true);
			const created = `${trimTrailingSlash(parent)}/${name}`;
			const result = await client.execute(`mkdir -- ${quoteShell(created)}`);
			if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `Unable to create ${created}`);
			return created;
		});
	}

	public async preflight(request: DeploymentPreflightRequest, signal?: AbortSignal): Promise<DeploymentPreflightResult> {
		const operationId = randomUUID();
		let temporaryArchivePath: string | undefined;
		this.emitProgress(operationId, "connecting", "Connecting to the Linux server");
		try {
			return await withClient(
				request.connection,
				async (client) => {
					this.emitProgress(operationId, "checking-paths", "Checking tools, paths and permissions");
					await assertRequiredTools(client, REQUIRED_TOOLS);

					const paths = await this.resolveAndValidatePaths(client, request);
					temporaryArchivePath = `${paths.destinationParent}/.gtnh-updater-${operationId}.zip`;
					const availableBeforeTransfer = await getAvailableBytes(client, paths.destinationParent);

					const expectedCompressedBytes = await fetchArchive(client, request.source, temporaryArchivePath, availableBeforeTransfer, {
						onUploadStart: () => this.emitProgress(operationId, "transferring", "Uploading the archive with SFTP"),
						onUploadProgress: (transferred, total) => {
							this.emit({ operationId, stage: "transferring", message: "Uploading the archive", transferredBytes: transferred, totalBytes: total });
						},
						onDownloadStart: () => this.emitProgress(operationId, "downloading", "Downloading the archive on the Linux server"),
					});

					this.emitProgress(operationId, "validating-archive", "Validating ZIP integrity and entries");
					const archive = await inspectRemoteArchive(client, temporaryArchivePath, expectedCompressedBytes);

					this.emitProgress(operationId, "checking-space", "Checking extraction space");
					const availableFreeBytes = await getAvailableBytes(client, paths.destinationParent);
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
				},
				signal
			);
		} catch (error) {
			this.emitProgress(operationId, "failed", getErrorMessage(error));
			if (temporaryArchivePath) await removeRemoteTemporaries(request.connection, [temporaryArchivePath]);
			throw error;
		}
	}

	public async execute(request: DeploymentExecuteRequest, signal?: AbortSignal): Promise<DeploymentResult> {
		const operation = this.operations.get(request.operationId);
		if (!operation) throw new Error("Deployment operation was not found or has expired");
		const { result, requestedDestinationPath } = operation;
		assertDeletionConfirmed(result.destinationNonEmpty, result.resolvedDestinationPath, request.confirmationPath);
		let destinationTouched = false;

		const failure = async (error: unknown): Promise<DeploymentResult> => {
			const message = signal?.aborted ? CANCELLED_MESSAGE : getErrorMessage(error);
			this.emitProgress(request.operationId, "failed", message);
			this.operations.delete(request.operationId);
			await removeRemoteTemporaries(operation.request.connection, [result.temporaryArchivePath]);
			return {
				operationId: request.operationId,
				status: "failed",
				destinationPath: requestedDestinationPath,
				partialDestinationPreserved: destinationTouched,
				error: message,
			};
		};

		try {
			return await withClient(
				operation.request.connection,
				async (client) => {
					this.emitProgress(request.operationId, "checking-paths", "Rechecking the destination before deletion");
					const currentPaths = await this.resolveAndValidatePaths(client, operation.request);
					if (
						currentPaths.resolvedOldServerPath !== result.resolvedOldServerPath ||
						currentPaths.resolvedDestinationPath !== result.resolvedDestinationPath ||
						currentPaths.destinationExists !== result.destinationExists ||
						currentPaths.destinationEntries.length > 0 !== result.destinationNonEmpty
					) {
						throw new Error("Remote paths changed after preflight; run preflight again");
					}

					destinationTouched = true;
					if (currentPaths.destinationExists) {
						this.emitProgress(request.operationId, "removing-destination", "Removing the existing destination");
						await client.executeTrackedChecked(`rm -rf -- ${quoteShell(requestedDestinationPath)}`);
					}
					await client.executeChecked(`mkdir -p -- ${quoteShell(requestedDestinationPath)}`);

					this.emitProgress(request.operationId, "extracting", "Extracting the validated archive");
					const extraction = await client.executeTracked(`unzip -q ${quoteShell(result.temporaryArchivePath)} -d ${quoteShell(requestedDestinationPath)}`);
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
				},
				signal
			);
		} catch (error) {
			return await failure(error);
		}
	}

	/** Removes the temporary ZIP of every preflight that was never deployed (app shutdown). */
	public async discardAll(): Promise<void> {
		const operations = [...this.operations.values()];
		this.operations.clear();
		await Promise.all(operations.map(async (operation) => await removeRemoteTemporaries(operation.request.connection, [operation.result.temporaryArchivePath])));
	}

	private async resolveAndValidatePaths(
		client: RemoteClient,
		request: DeploymentPreflightRequest
	): Promise<{
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

		const resolvedOldServerPath = (
			await client.executeChecked(
				`test -d ${quoteShell(requestedOldPath)} && test -r ${quoteShell(requestedOldPath)} && test -x ${quoteShell(requestedOldPath)} && cd ${quoteShell(requestedOldPath)} && pwd -P`
			)
		).trim();
		const destinationParent = (
			await client.executeChecked(
				`test -d ${quoteShell(destinationParentInput)} && test -w ${quoteShell(destinationParentInput)} && test -x ${quoteShell(destinationParentInput)} && cd ${quoteShell(destinationParentInput)} && pwd -P`
			)
		).trim();
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

		const destinationEntries = destinationExists ? await client.listDirectory(requestedDestinationPath) : [];

		return { requestedDestinationPath, destinationParent, resolvedOldServerPath, resolvedDestinationPath, destinationExists, destinationEntries };
	}

	private emitProgress(operationId: string, stage: DeploymentProgress["stage"], message: string): void {
		this.emit({ operationId, stage, message });
	}
}

function trimTrailingSlash(value: string): string {
	return value.length > 1 ? value.replace(/\/+$/, "") : value;
}
