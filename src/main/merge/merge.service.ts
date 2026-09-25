import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
	MergeApplyRequest,
	MergeApplyResult,
	MergeContentKind,
	MergeDecision,
	MergeDocument,
	MergeFileEntry,
	MergeFileRequest,
	MergePrepareRequest,
	MergePrepareResult,
	MergeProgress,
} from "@shared/merge.types";
import { RemoteClient, quoteShell } from "../ssh/remote-client";
import {
	CANCELLED_MESSAGE,
	assertRequiredTools,
	ensureDirectory,
	fetchArchive,
	getAvailableBytes,
	getErrorMessage,
	inspectRemoteArchive,
	removeRemoteTemporaries,
	resolveDirectory,
	withClient,
} from "../ssh/remote-operations";
import { findWorldDirectories, resolveWorldData } from "../migration/world-data";
import { assertEnoughSpace, assertSeparateTrees, calculateRequiredFreeBytes } from "../deployment/deployment-policy";
import { buildMergedText, isUserChange } from "@shared/merge-model";
import { compareConfigs } from "./config-compare";
import {
	DEFAULT_EXCLUSIONS,
	MAX_TEXT_MERGE_BYTES,
	type TextFormat,
	classifyTrees,
	createExclusionMatcher,
	describeBaseMismatch,
	detectContentKind,
	formatText,
	mergeThreeWay,
	parseHashListing,
	parseText,
} from "./merge-policy";

type PreparedMerge = {
	request: MergePrepareRequest;
	result: MergePrepareResult;
	baseDirectory: string;
	files: Map<string, MergeFileEntry>;
	/** Formats of new text files, recorded when a conflict document is loaded. */
	newTextFormats: Map<string, TextFormat>;
};

const COPY_BATCH_SIZE = 100;
/** Configuration files are small; anything larger keeps the byte comparison. */
const MAX_CONFIG_COMPARE_BYTES = 1024 * 1024;

export class MergeService {
	private readonly operations = new Map<string, PreparedMerge>();

	public constructor(private readonly emit: (progress: MergeProgress) => void) {}

	public async prepare(request: MergePrepareRequest, signal?: AbortSignal): Promise<MergePrepareResult> {
		const operationId = randomUUID();
		const extraExclusions = request.extraExclusions.map((pattern) => pattern.trim()).filter(Boolean);
		createExclusionMatcher(extraExclusions);
		const temporaries: string[] = [];
		this.emitProgress(operationId, "connecting", "Connecting to the Linux server");

		try {
			return await withClient(
				request.connection,
				async (client) => {
					this.emitProgress(operationId, "checking-paths", "Checking tools, paths and permissions");
					await assertRequiredTools(client, ["sh", "curl", "unzip", "find", "sha256sum", "setsid"]);
					const resolvedOldServerPath = await resolveDirectory(client, request.oldServerPath, "Old server path", false);
					// The folder is created when the deployment step was skipped or the path was typed by hand.
					const resolvedNewServerPath = await ensureDirectory(client, request.newServerPath, "New server path");
					assertSeparateTrees(resolvedOldServerPath, resolvedNewServerPath);
					// Comparing against an empty tree would silently propose nothing; say what is missing instead.
					if ((await client.executeChecked(`find ${quoteShell(resolvedNewServerPath)} -mindepth 1 -maxdepth 1 -print -quit`)).trim() === "") {
						throw new Error(`The new server ${resolvedNewServerPath} is empty: deploy the new version there before carrying over your changes`);
					}

					const parent = path.posix.dirname(resolvedNewServerPath);
					if ((await client.execute(`test -w ${quoteShell(parent)}`)).exitCode !== 0) {
						throw new Error("The parent of the new server must be writable to store the original archive temporarily");
					}
					const baseDirectory = `${parent}/.gtnh-updater-base-${operationId}`;
					const archivePath = `${baseDirectory}.zip`;
					temporaries.push(baseDirectory, archivePath);

					await this.extractBase(client, operationId, request, parent, archivePath, baseDirectory);

					this.emitProgress(operationId, "hashing", "Comparing old server, original archive and new server");
					// Worlds and their outside data are copied by the migration step, never merged.
					const worldDirectories = await findWorldDirectories(client, resolvedOldServerPath);
					const worldDataPaths = await resolveWorldData(client, resolvedOldServerPath)
						.then((data) => data.dataPaths)
						.catch(() => []);
					const excludedPatterns = [
						...DEFAULT_EXCLUSIONS,
						...worldDirectories.map((name) => `/${name}/`),
						...worldDataPaths.map((dataPath) => `/${dataPath}`),
						...extraExclusions,
					];
					const isExcluded = createExclusionMatcher(excludedPatterns);
					const pruned = ["mods", "libraries", "logs", "crash-reports", "backups", ...worldDirectories];
					const oldTree = parseHashListing(await hashTree(client, resolvedOldServerPath, pruned), isExcluded);
					const baseTree = parseHashListing(await hashTree(client, baseDirectory, pruned), isExcluded);
					const newTree = parseHashListing(await hashTree(client, resolvedNewServerPath, pruned), isExcluded);
					const classification = classifyTrees(oldTree, baseTree, newTree);

					this.emitProgress(operationId, "hashing", "Telling your edits apart from configuration files rewritten by mods");
					const files = await this.separateModRewrites(client, classification.files, resolvedOldServerPath, baseDirectory);

					const result: MergePrepareResult = {
						operationId,
						resolvedOldServerPath,
						resolvedNewServerPath,
						files,
						comparedBaseFiles: classification.comparedBaseFiles,
						userChangedBaseFiles: classification.userChangedBaseFiles,
						excludedPatterns,
						baseMismatchWarning: describeBaseMismatch(classification.comparedBaseFiles, classification.userChangedBaseFiles),
					};
					this.operations.set(operationId, {
						request,
						result,
						baseDirectory,
						files: new Map(files.map((file) => [file.path, file])),
						newTextFormats: new Map(),
					});
					this.emitProgress(operationId, "ready", `${files.filter(isUserChange).length} user changes found`);
					return result;
				},
				signal
			);
		} catch (error) {
			this.emitProgress(operationId, "failed", getErrorMessage(error));
			await removeRemoteTemporaries(request.connection, temporaries);
			throw error;
		}
	}

	public async loadFile(request: MergeFileRequest): Promise<MergeDocument> {
		const operation = this.getOperation(request.operationId);
		const file = operation.files.get(request.path);
		if (!file) throw new Error("File is not part of this merge");
		const { resolvedOldServerPath, resolvedNewServerPath } = operation.result;

		return await withClient(operation.request.connection, async (client) => {
			const oldFile = await client.readFile(`${resolvedOldServerPath}/${file.path}`, MAX_TEXT_MERGE_BYTES);
			const baseFile = await readOptional(client, `${operation.baseDirectory}/${file.path}`);
			const newFile = await readOptional(client, `${resolvedNewServerPath}/${file.path}`);
			const sides = [oldFile, baseFile, newFile].filter((side) => side !== undefined);

			const contentKind = sides.reduce<MergeContentKind>((kind, side) => {
				const sideKind = side.content ? detectContentKind(side.content) : "large";
				return kind === "text" ? sideKind : kind;
			}, "text");
			if (contentKind !== "text") {
				return { contentKind, oldSize: oldFile.size, newSize: newFile?.size ?? 0 };
			}

			const oldText = parseText(oldFile.content!);
			const baseLines = baseFile ? parseText(baseFile.content!).lines : [];
			// Non-conflicting kinds are previewed as the user's changes against the original file.
			const newLines = file.kind === "conflict" && newFile ? parseText(newFile.content!).lines : baseLines;
			if (file.kind === "conflict" && newFile) {
				operation.newTextFormats.set(file.path, parseText(newFile.content!).format);
			}
			const blocks = mergeThreeWay(baseLines, oldText.lines, newLines);
			return {
				contentKind: "text",
				base: baseLines.join("\n"),
				old: oldText.lines.join("\n"),
				new: newLines.join("\n"),
				merged: buildMergedText(blocks),
				conflictCount: blocks.filter((block) => block.type === "conflict").length,
			};
		});
	}

	public async apply(request: MergeApplyRequest, signal?: AbortSignal): Promise<MergeApplyResult> {
		const operation = this.getOperation(request.operationId);
		if (operation.result.baseMismatchWarning && !request.baseMismatchAcknowledged) {
			throw new Error("Confirm the original archive warning before applying changes");
		}
		const decisions = validateDecisions(operation, request.decisions);
		const { resolvedOldServerPath, resolvedNewServerPath } = operation.result;
		const copies = decisions.filter((decision) => decision.action === "take-old");
		const writes = decisions.filter((decision) => decision.action === "write");
		const kept = decisions.length - copies.length - writes.length;
		let currentPath: string | undefined;
		let copied = 0;
		let written = 0;

		try {
			return await withClient(
				operation.request.connection,
				async (client) => {
					this.emitProgress(request.operationId, "applying", "Applying selected changes to the new server");
					for (let offset = 0; offset < copies.length; offset += COPY_BATCH_SIZE) {
						const batch = copies.slice(offset, offset + COPY_BATCH_SIZE);
						currentPath = batch[0]?.path;
						const script = [
							"set -e",
							...batch.map((decision) => copyScript(`${resolvedOldServerPath}/${decision.path}`, `${resolvedNewServerPath}/${decision.path}`)),
						].join("\n");
						const execution = await client.executeTracked(script);
						if (execution.exitCode !== 0) {
							const done = execution.stdout.split("\n").filter(Boolean).length;
							currentPath = batch[done]?.path ?? currentPath;
							copied += done;
							throw new Error(execution.stderr.trim() || `Copy failed with exit code ${String(execution.exitCode)}`);
						}
						copied += batch.length;
						this.emit({
							operationId: request.operationId,
							stage: "applying",
							message: "Copying user files",
							transferredBytes: offset + batch.length,
							totalBytes: copies.length,
						});
					}

					for (const decision of writes) {
						currentPath = decision.path;
						const target = `${resolvedNewServerPath}/${decision.path}`;
						const temporary = `${target}.gtnh-merge-${request.operationId}`;
						await client.writeFile(temporary, formatText(decision.lines, operation.newTextFormats.get(decision.path)!));
						await client.executeChecked(
							`chmod --reference=${quoteShell(target)} -- ${quoteShell(temporary)} && mv -f -- ${quoteShell(temporary)} ${quoteShell(target)}`
						);
						written += 1;
					}
					currentPath = undefined;

					this.emitProgress(request.operationId, "cleaning-up", "Removing the temporary original archive");
					await client.executeChecked(`rm -rf -- ${quoteShell(operation.baseDirectory)}`);
					this.operations.delete(request.operationId);
					this.emitProgress(request.operationId, "completed", "User changes applied to the new server");
					return { operationId: request.operationId, status: "completed" as const, copied, written, kept };
				},
				signal
			);
		} catch (error) {
			// No resumption: the merge must be prepared again, so its temporary base is removed.
			const message = signal?.aborted ? CANCELLED_MESSAGE : getErrorMessage(error);
			this.emitProgress(request.operationId, "failed", message);
			this.operations.delete(request.operationId);
			await removeRemoteTemporaries(operation.request.connection, [operation.baseDirectory]);
			return {
				operationId: request.operationId,
				status: "failed",
				copied,
				written,
				kept,
				failedPath: currentPath,
				error: message,
			};
		}
	}

	public async discard(operationId: string): Promise<void> {
		const operation = this.operations.get(operationId);
		if (!operation) return;
		this.operations.delete(operationId);
		await removeRemoteTemporaries(operation.request.connection, [operation.baseDirectory]);
	}

	/** Removes the temporary base of every merge prepared but never applied (app shutdown). */
	public async discardAll(): Promise<void> {
		await Promise.all([...this.operations.keys()].map(async (operationId) => await this.discard(operationId)));
	}

	/**
	 * Files whose bytes differ may only have been rewritten by a mod at a server start. Both
	 * versions are read in one command and compared key by key for known configuration formats.
	 */
	private async separateModRewrites(client: RemoteClient, files: MergeFileEntry[], oldServerPath: string, baseDirectory: string): Promise<MergeFileEntry[]> {
		const candidates = files.filter((file) => file.kind === "user-modified" || file.kind === "conflict");
		if (candidates.length === 0) return files;
		const paths = candidates.map((file) => file.path);
		const listPath = `${baseDirectory}.paths`;
		try {
			await client.writeFile(listPath, Buffer.from(`${paths.join("\n")}\n`, "utf8"));
			const [oldTexts, baseTexts] = [await readListedFiles(client, oldServerPath, listPath), await readListedFiles(client, baseDirectory, listPath)];
			return files.map((file) => {
				const oldText = oldTexts.get(file.path);
				const baseText = baseTexts.get(file.path);
				if (oldText === undefined || baseText === undefined) return file;
				return compareConfigs(file.path, baseText, oldText) === "regenerated" ? { ...file, kind: "regenerated" as const } : file;
			});
		} finally {
			await client.execute(`rm -f -- ${quoteShell(listPath)}`);
		}
	}

	private async extractBase(client: RemoteClient, operationId: string, request: MergePrepareRequest, parent: string, archivePath: string, baseDirectory: string): Promise<void> {
		const expectedCompressedBytes = await fetchArchive(client, request.baseSource, archivePath, await getAvailableBytes(client, parent), {
			onUploadStart: () => this.emitProgress(operationId, "transferring", "Uploading the original archive with SFTP"),
			onUploadProgress: (transferred, total) => {
				this.emit({ operationId, stage: "transferring", message: "Uploading the original archive", transferredBytes: transferred, totalBytes: total });
			},
			onDownloadStart: () => this.emitProgress(operationId, "downloading", "Downloading the original archive on the Linux server"),
		});

		this.emitProgress(operationId, "validating-archive", "Validating the original archive");
		const archive = await inspectRemoteArchive(client, archivePath, expectedCompressedBytes);
		assertEnoughSpace(await getAvailableBytes(client, parent), calculateRequiredFreeBytes(archive.uncompressedBytes));

		this.emitProgress(operationId, "extracting-base", "Extracting the original archive to a temporary directory");
		await client.executeChecked(`mkdir -- ${quoteShell(baseDirectory)}`);
		await client.executeTrackedChecked(`unzip -q ${quoteShell(archivePath)} -d ${quoteShell(baseDirectory)}`);
		await client.executeChecked(`rm -f -- ${quoteShell(archivePath)}`);
	}

	private getOperation(operationId: string): PreparedMerge {
		const operation = this.operations.get(operationId);
		if (!operation) throw new Error("Merge operation was not found or has expired");
		return operation;
	}

	private emitProgress(operationId: string, stage: MergeProgress["stage"], message: string): void {
		this.emit({ operationId, stage, message });
	}
}

export function validateDecisions(operation: Pick<PreparedMerge, "files" | "newTextFormats">, decisions: MergeDecision[]): MergeDecision[] {
	const seen = new Set<string>();
	for (const decision of decisions) {
		const file = operation.files.get(decision.path);
		if (!file) throw new Error(`File is not part of this merge: ${decision.path}`);
		if (seen.has(decision.path)) throw new Error(`Duplicate decision for ${decision.path}`);
		seen.add(decision.path);
		if (decision.action === "write") {
			if (file.kind !== "conflict" || !operation.newTextFormats.has(decision.path)) {
				throw new Error(`Merged text can only be written for a reviewed text conflict: ${decision.path}`);
			}
		}
	}
	const unreviewed = [...operation.files.values()].filter((file) => file.kind === "conflict" && !seen.has(file.path));
	if (unreviewed.length > 0) {
		throw new Error(`${unreviewed.length} conflicting files still need a decision`);
	}
	return decisions;
}

function copyScript(source: string, target: string): string {
	const temporary = `${target}.gtnh-merge-copy`;
	return [
		`mkdir -p -- ${quoteShell(path.posix.dirname(target))}`,
		`cp -p -- ${quoteShell(source)} ${quoteShell(temporary)}`,
		`if [ -f ${quoteShell(target)} ]; then chmod --reference=${quoteShell(target)} -- ${quoteShell(temporary)}; fi`,
		`mv -f -- ${quoteShell(temporary)} ${quoteShell(target)}`,
		"echo done",
	].join("\n");
}

async function hashTree(client: RemoteClient, root: string, prunedDirectories: string[]): Promise<string> {
	const prune = prunedDirectories.map((name) => `-path ${quoteShell(`./${name}`)}`).join(" -o ");
	return await client.executeTrackedChecked(`cd ${quoteShell(root)} && find . \\( ${prune} \\) -prune -o -type f ! -name '*.jar' -exec sha256sum -- {} +`);
}

async function readOptional(client: RemoteClient, remotePath: string): Promise<{ size: number; content?: Buffer } | undefined> {
	const exists = (await client.execute(`test -f ${quoteShell(remotePath)}`)).exitCode === 0;
	return exists ? await client.readFile(remotePath, MAX_TEXT_MERGE_BYTES) : undefined;
}

/** Streams the listed files of one tree in a single command; oversized files are skipped. */
async function readListedFiles(client: RemoteClient, root: string, listPath: string): Promise<Map<string, string>> {
	const marker = `===GTNH-${randomUUID()}===`;
	const output = await client.executeChecked(
		[
			`cd ${quoteShell(root)} || exit 0`,
			`while IFS= read -r entry; do`,
			`  printf '%s%s\\n' ${quoteShell(marker)} "$entry"`,
			`  size=$(stat -c %s -- "$entry" 2>/dev/null || echo 0)`,
			`  if [ "$size" -gt 0 ] && [ "$size" -le ${MAX_CONFIG_COMPARE_BYTES} ]; then cat -- "$entry"; printf '\\n'; fi`,
			`done < ${quoteShell(listPath)}`,
		].join("\n")
	);

	const contents = new Map<string, string>();
	for (const block of output.split(marker).slice(1)) {
		const lineBreak = block.indexOf("\n");
		if (lineBreak < 0) continue;
		const path = block.slice(0, lineBreak);
		const body = block.slice(lineBreak + 1);
		if (body !== "") contents.set(path, body.slice(0, -1));
	}
	return contents;
}
