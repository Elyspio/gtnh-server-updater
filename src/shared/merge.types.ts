import type { ArchiveSource, SshConnectionInput } from "./deployment.types";

export type MergePrepareRequest = {
	connection: SshConnectionInput;
	baseSource: ArchiveSource;
	oldServerPath: string;
	newServerPath: string;
	extraExclusions: string[];
};

/**
 * user-modified: old ≠ base and new = base; the old file is taken by default.
 * conflict: old ≠ base and new ≠ base (or added on both sides); needs review.
 * user-added: only in the old server, under a folder whose data is carried over; taken by default.
 * mod-added: only in the old server, elsewhere; a mod created it at runtime and will do so again,
 *   so it is kept out of the proposals and shown under its own filter.
 * removed-by-new: modified by the user but absent from the new version; not copied by default.
 * regenerated: the bytes differ but the configuration is the same key by key, so a mod rewrote
 *   it at a server start; kept out of the proposals and shown under its own filter.
 */
export type MergeFileKind = "user-modified" | "conflict" | "user-added" | "mod-added" | "removed-by-new" | "regenerated";

export type MergeFileEntry = {
	path: string;
	kind: MergeFileKind;
};

export type MergePrepareResult = {
	operationId: string;
	resolvedOldServerPath: string;
	resolvedNewServerPath: string;
	files: MergeFileEntry[];
	comparedBaseFiles: number;
	userChangedBaseFiles: number;
	excludedPatterns: string[];
	baseMismatchWarning?: string;
};

export type MergeContentKind = "text" | "binary" | "non-utf8" | "large";

export type MergeBlock =
	| { type: "stable"; lines: string[] }
	| { type: "resolved"; source: "old" | "new" | "both"; lines: string[] }
	| { type: "conflict"; id: number; base: string[]; old: string[]; new: string[] };

export type MergeDocument =
	| {
			contentKind: "text";
			/** The three versions, shown side by side, plus the pre-merged result to review. */
			base: string;
			old: string;
			new: string;
			merged: string;
			conflictCount: number;
	  }
	| { contentKind: Exclude<MergeContentKind, "text">; oldSize: number; newSize: number };

export type MergeFileRequest = { operationId: string; path: string };

/**
 * keep-new: leave the extracted new file untouched.
 * take-old: copy the old server file over the new one.
 * write: write reviewed text; only valid for text conflicts.
 */
export type MergeDecision = { path: string; action: "keep-new" } | { path: string; action: "take-old" } | { path: string; action: "write"; lines: string[] };

export type MergeApplyRequest = {
	operationId: string;
	baseMismatchAcknowledged: boolean;
	decisions: MergeDecision[];
};

export type MergeApplyResult = {
	operationId: string;
	status: "completed" | "failed";
	copied: number;
	written: number;
	kept: number;
	failedPath?: string;
	error?: string;
};

export type MergeStage =
	| "connecting"
	| "checking-paths"
	| "transferring"
	| "downloading"
	| "validating-archive"
	| "extracting-base"
	| "hashing"
	| "ready"
	| "applying"
	| "cleaning-up"
	| "completed"
	| "failed";

export type MergeProgress = {
	operationId: string;
	stage: MergeStage;
	message: string;
	transferredBytes?: number;
	totalBytes?: number;
};
