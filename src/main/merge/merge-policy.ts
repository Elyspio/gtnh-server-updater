import { diffArrays } from "diff";
import { DEFAULT_EXCLUSIONS, isCarriedOverAddition } from "@shared/merge-model";
import type { MergeBlock, MergeContentKind, MergeFileEntry } from "@shared/merge.types";

export { DEFAULT_EXCLUSIONS };

export const MAX_TEXT_MERGE_BYTES = 2 * 1024 * 1024;
const BASE_MISMATCH_RATIO = 0.5;

/**
 * Gitignore-like patterns against paths relative to the server root.
 * A leading "/" anchors to the root, a trailing "/" matches everything below a directory,
 * and a pattern without "/" matches at any depth.
 */
export function createExclusionMatcher(patterns: readonly string[]): (relativePath: string) => boolean {
	const expressions = patterns.map((pattern) => compilePattern(pattern.trim())).filter((value) => value !== undefined);
	return (relativePath) => expressions.some((expression) => expression.test(relativePath));
}

function compilePattern(pattern: string): RegExp | undefined {
	if (!pattern || pattern === "/") return undefined;
	const anchored = pattern.startsWith("/");
	const directoryOnly = pattern.endsWith("/");
	const body = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
	if (!body || body.split("/").includes("..")) throw new Error(`Invalid exclusion pattern: ${pattern}`);
	const prefix = anchored || body.includes("/") ? "" : "(?:.*/)?";
	const source = globToRegex(body);
	return directoryOnly ? new RegExp(`^${prefix}${source}/`) : new RegExp(`^${prefix}${source}(?:/.*)?$`);
}

function globToRegex(glob: string): string {
	let result = "";
	for (let index = 0; index < glob.length; index += 1) {
		const character = glob[index]!;
		if (character === "*" && glob[index + 1] === "*") {
			result += ".*";
			index += 1;
		} else if (character === "*") {
			result += "[^/]*";
		} else if (character === "?") {
			result += "[^/]";
		} else {
			result += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		}
	}
	return result;
}

export type TreeHashes = ReadonlyMap<string, string>;

export type Classification = {
	files: MergeFileEntry[];
	comparedBaseFiles: number;
	userChangedBaseFiles: number;
};

export function classifyTrees(oldTree: TreeHashes, baseTree: TreeHashes, newTree: TreeHashes): Classification {
	const files: MergeFileEntry[] = [];
	let comparedBaseFiles = 0;
	let userChangedBaseFiles = 0;

	for (const [path, oldHash] of oldTree) {
		const baseHash = baseTree.get(path);
		const newHash = newTree.get(path);
		if (baseHash === undefined) {
			if (newHash === undefined) files.push({ path, kind: isCarriedOverAddition(path) ? "user-added" : "mod-added" });
			else if (newHash !== oldHash) files.push({ path, kind: "conflict" });
			continue;
		}

		comparedBaseFiles += 1;
		if (oldHash === baseHash) continue;
		userChangedBaseFiles += 1;
		if (newHash === undefined) files.push({ path, kind: "removed-by-new" });
		else if (newHash === baseHash) files.push({ path, kind: "user-modified" });
		else if (newHash !== oldHash) files.push({ path, kind: "conflict" });
	}

	files.sort((left, right) => left.path.localeCompare(right.path));
	return { files, comparedBaseFiles, userChangedBaseFiles };
}

export function describeBaseMismatch(comparedBaseFiles: number, userChangedBaseFiles: number): string | undefined {
	if (comparedBaseFiles === 0) {
		return "No file of the original archive was found in the old server. The original archive probably does not match this installation.";
	}
	const ratio = userChangedBaseFiles / comparedBaseFiles;
	if (ratio > BASE_MISMATCH_RATIO) {
		return `${Math.round(ratio * 100)}% of the compared original files differ from the old server. The original archive may not match this installation.`;
	}
	return undefined;
}

/** Parses `sha256sum` output relative to a tree root; paths are printed as "./relative/path". */
export function parseHashListing(output: string, isExcluded: (relativePath: string) => boolean): Map<string, string> {
	const hashes = new Map<string, string>();
	for (const line of output.split("\n")) {
		if (!line) continue;
		const match = /^(\\?)([0-9a-f]{64}) [ *]\.\/(.+)$/.exec(line);
		if (!match) throw new Error(`Unexpected checksum line: ${line.slice(0, 120)}`);
		if (match[1]) throw new Error(`Unsupported file name with special characters: ${match[3]}`);
		const relativePath = match[3]!;
		if (!isExcluded(relativePath)) hashes.set(relativePath, match[2]!);
	}
	return hashes;
}

export function detectContentKind(content: Uint8Array): MergeContentKind {
	if (content.byteLength > MAX_TEXT_MERGE_BYTES) return "large";
	if (content.includes(0)) return "binary";
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(content);
		return "text";
	} catch {
		return "non-utf8";
	}
}

export type TextFormat = { bom: boolean; eol: "\n" | "\r\n"; finalNewline: boolean };

export function parseText(content: Uint8Array): { lines: string[]; format: TextFormat } {
	let text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
	const bom = text.startsWith("\uFEFF");
	if (bom) text = text.slice(1);
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const finalNewline = text.endsWith("\n");
	const lines = text.split(/\r?\n/);
	if (finalNewline) lines.pop();
	if (text === "") lines.length = 0;
	return { lines, format: { bom, eol, finalNewline } };
}

export function formatText(lines: readonly string[], format: TextFormat): Buffer {
	let text = lines.join(format.eol);
	if (format.finalNewline && lines.length > 0) text += format.eol;
	if (format.bom) text = `\uFEFF${text}`;
	return Buffer.from(text, "utf8");
}

type Hunk = { side: "old" | "new"; start: number; end: number; lines: string[] };

function toHunks(base: string[], other: string[], side: Hunk["side"]): Hunk[] {
	const hunks: Hunk[] = [];
	let baseIndex = 0;
	let pending: Hunk | undefined;
	for (const change of diffArrays(base, other)) {
		if (!change.added && !change.removed) {
			if (pending) hunks.push(pending);
			pending = undefined;
			baseIndex += change.count;
			continue;
		}
		pending ??= { side, start: baseIndex, end: baseIndex, lines: [] };
		if (change.removed) {
			baseIndex += change.count;
			pending.end = baseIndex;
		} else {
			pending.lines.push(...change.value);
		}
	}
	if (pending) hunks.push(pending);
	return hunks;
}

function applyHunks(base: string[], start: number, end: number, hunks: Hunk[]): string[] {
	const result: string[] = [];
	let position = start;
	for (const hunk of hunks) {
		result.push(...base.slice(position, hunk.start), ...hunk.lines);
		position = hunk.end;
	}
	result.push(...base.slice(position, end));
	return result;
}

/**
 * Three-way line merge. Changes made on one side only are applied; changes that touch or
 * overlap on both sides become conflicts unless both sides produced the same lines.
 */
export function mergeThreeWay(base: string[], oldLines: string[], newLines: string[]): MergeBlock[] {
	const hunks = [...toHunks(base, oldLines, "old"), ...toHunks(base, newLines, "new")].sort((left, right) => left.start - right.start || left.end - right.end);
	const blocks: MergeBlock[] = [];
	let position = 0;
	let conflictId = 0;
	let index = 0;

	const pushStable = (lines: string[]): void => {
		if (lines.length > 0) blocks.push({ type: "stable", lines });
	};

	while (index < hunks.length) {
		const group = [hunks[index]!];
		let groupStart = hunks[index]!.start;
		let groupEnd = hunks[index]!.end;
		index += 1;
		while (index < hunks.length && hunks[index]!.start <= groupEnd) {
			groupStart = Math.min(groupStart, hunks[index]!.start);
			groupEnd = Math.max(groupEnd, hunks[index]!.end);
			group.push(hunks[index]!);
			index += 1;
		}

		pushStable(base.slice(position, groupStart));
		const oldHunks = group.filter((hunk) => hunk.side === "old");
		const newHunks = group.filter((hunk) => hunk.side === "new");
		const oldResult = applyHunks(base, groupStart, groupEnd, oldHunks);
		const newResult = applyHunks(base, groupStart, groupEnd, newHunks);
		if (newHunks.length === 0) {
			blocks.push({ type: "resolved", source: "old", lines: oldResult });
		} else if (oldHunks.length === 0) {
			blocks.push({ type: "resolved", source: "new", lines: newResult });
		} else if (sameLines(oldResult, newResult)) {
			blocks.push({ type: "resolved", source: "both", lines: newResult });
		} else {
			blocks.push({ type: "conflict", id: conflictId, base: base.slice(groupStart, groupEnd), old: oldResult, new: newResult });
			conflictId += 1;
		}
		position = groupEnd;
	}
	pushStable(base.slice(position));
	return blocks;
}

function sameLines(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((line, index) => line === right[index]);
}
