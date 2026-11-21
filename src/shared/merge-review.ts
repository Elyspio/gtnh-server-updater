import { diffArrays } from "diff";
import { CONFLICT_END, CONFLICT_SEPARATOR, CONFLICT_START } from "./merge-model";

/** Lines where one side differs from the result, 0-based, ends excluded. A range can be empty. */
export type Hunk = { sideStart: number; sideEnd: number; resultStart: number; resultEnd: number };

/** Line indexes of the three markers of one conflict block. */
export type ConflictRegion = { start: number; separator: number; end: number };

/** A result range, 0-based, end excluded; empty when the result lacks lines one side has. */
export type LineRange = { start: number; end: number };

export type NavigationTargets = { kind: "conflict" | "difference"; ranges: LineRange[] };

export function findConflicts(lines: string[]): ConflictRegion[] {
	const regions: ConflictRegion[] = [];
	let start = -1;
	let separator = -1;
	lines.forEach((line, index) => {
		if (line === CONFLICT_START) {
			start = index;
			separator = -1;
		} else if (line === CONFLICT_SEPARATOR && start >= 0) {
			separator = index;
		} else if (line === CONFLICT_END && separator >= 0) {
			regions.push({ start, separator, end: index });
			start = -1;
			separator = -1;
		}
	});
	return regions;
}

type Segment = { sideStart: number; otherStart: number; length: number };

/** Differing blocks between `side` and `other`, and the common runs between them. */
function diffBlocks(side: string[], other: string[]): { hunks: Hunk[]; common: Segment[] } {
	const hunks: Hunk[] = [];
	const common: Segment[] = [];
	let sideIndex = 0;
	let otherIndex = 0;
	let open: Hunk | undefined;
	for (const change of diffArrays(side, other)) {
		const count = change.value.length;
		if (!change.added && !change.removed) {
			if (open) hunks.push(open);
			open = undefined;
			common.push({ sideStart: sideIndex, otherStart: otherIndex, length: count });
			sideIndex += count;
			otherIndex += count;
			continue;
		}
		open ??= { sideStart: sideIndex, sideEnd: sideIndex, resultStart: otherIndex, resultEnd: otherIndex };
		if (change.removed) sideIndex += count;
		else otherIndex += count;
		open.sideEnd = sideIndex;
		open.resultEnd = otherIndex;
	}
	if (open) hunks.push(open);
	return { hunks, common };
}

/**
 * Blocks where `side` differs from `result`. Each conflict block gets its own hunk that covers the
 * whole block, markers included, and maps to the lines of this side's section, so taking a side
 * resolves the conflict without touching the changes merged around it.
 */
export function sideHunks(side: string[], result: string[], which: "old" | "new"): Hunk[] {
	// The result as this side would have it: each conflict block reduced to this side's section.
	const virtual: string[] = [];
	const spans: Array<{ start: number; end: number; real: LineRange }> = [];
	let cursor = 0;
	for (const conflict of findConflicts(result)) {
		virtual.push(...result.slice(cursor, conflict.start));
		const section = which === "old" ? result.slice(conflict.start + 1, conflict.separator) : result.slice(conflict.separator + 1, conflict.end);
		spans.push({ start: virtual.length, end: virtual.length + section.length, real: { start: conflict.start, end: conflict.end + 1 } });
		virtual.push(...section);
		cursor = conflict.end + 1;
	}
	virtual.push(...result.slice(cursor));

	const { hunks, common } = diffBlocks(side, virtual);
	const toReal = (line: number): number =>
		line + spans.filter((span) => span.end <= line).reduce((shift, span) => shift + (span.real.end - span.real.start) - (span.end - span.start), 0);
	const sideAt = (line: number): number | undefined => {
		if (line === 0) return 0;
		if (line === virtual.length) return side.length;
		const segment = common.find((candidate) => line >= candidate.otherStart && line <= candidate.otherStart + candidate.length);
		return segment ? segment.sideStart + line - segment.otherStart : undefined;
	};

	const absorbed = new Set<Hunk>();
	const conflictHunks = spans.map((span): Hunk => {
		const inside = hunks.filter((hunk) =>
			span.start === span.end
				? hunk.resultStart <= span.start && hunk.resultEnd >= span.start
				: (hunk.resultStart < span.end && hunk.resultEnd > span.start) ||
					(hunk.resultStart === hunk.resultEnd && hunk.resultStart > span.start && hunk.resultStart < span.end)
		);
		inside.forEach((hunk) => absorbed.add(hunk));
		const starts = [sideAt(span.start), ...inside.map((hunk) => hunk.sideStart)].filter((line) => line !== undefined);
		const ends = [sideAt(span.end), ...inside.map((hunk) => hunk.sideEnd)].filter((line) => line !== undefined);
		return {
			sideStart: Math.min(...starts),
			sideEnd: Math.max(...ends),
			resultStart: Math.min(span.real.start, ...inside.filter((hunk) => hunk.resultStart < span.start).map((hunk) => toReal(hunk.resultStart))),
			resultEnd: Math.max(span.real.end, ...inside.filter((hunk) => hunk.resultEnd > span.end).map((hunk) => toReal(hunk.resultEnd))),
		};
	});
	const plain = hunks.filter((hunk) => !absorbed.has(hunk)).map((hunk) => ({ ...hunk, resultStart: toReal(hunk.resultStart), resultEnd: toReal(hunk.resultEnd) }));
	return [...plain, ...conflictHunks].sort((a, b) => a.resultStart - b.resultStart || a.resultEnd - b.resultEnd);
}

/** Blank lines to show after `afterLine` lines of a pane (Monaco's `afterLineNumber`). */
export type Filler = { afterLine: number; lines: number };

/**
 * Fillers that give the three panes the same height block by block, so every line sits level with
 * its counterpart and the panes can share one scroll position.
 */
export function alignmentFillers(oldHunks: Hunk[], newHunks: Hunk[]): { old: Filler[]; result: Filler[]; new: Filler[] } {
	const ranges = [...oldHunks, ...newHunks].map((hunk) => ({ start: hunk.resultStart, end: hunk.resultEnd })).sort((a, b) => a.start - b.start || a.end - b.end);
	const sections: LineRange[] = [];
	for (const range of ranges) {
		const last = sections.at(-1);
		if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
		else sections.push({ ...range });
	}
	// Section bounds never fall inside a hunk: every line outside the hunks before them is shared.
	const sideLine = (hunks: Hunk[], line: number, inclusive: boolean): number =>
		hunks
			.filter((hunk) => (inclusive ? hunk.resultStart <= line : hunk.resultStart < line))
			.reduce((total, hunk) => total + (hunk.sideEnd - hunk.sideStart) - (hunk.resultEnd - hunk.resultStart), line);
	const fillers = { old: [] as Filler[], result: [] as Filler[], new: [] as Filler[] };
	for (const section of sections) {
		const oldEnd = sideLine(oldHunks, section.end, true);
		const newEnd = sideLine(newHunks, section.end, true);
		const heights = { old: oldEnd - sideLine(oldHunks, section.start, false), result: section.end - section.start, new: newEnd - sideLine(newHunks, section.start, false) };
		const tallest = Math.max(heights.old, heights.result, heights.new);
		const ends = { old: oldEnd, result: section.end, new: newEnd };
		for (const pane of ["old", "result", "new"] as const) {
			if (heights[pane] < tallest) fillers[pane].push({ afterLine: ends[pane], lines: tallest - heights[pane] });
		}
	}
	return fillers;
}

/** Character offsets that replace lines [start, end) of `text` with `lines`. */
export function replaceLines(text: string, start: number, end: number, lines: string[]): { start: number; end: number; text: string } {
	const existing = text.split("\n");
	const offsetOf = (line: number): number => existing.slice(0, line).reduce((total, current) => total + current.length + 1, 0);
	const inserted = lines.join("\n");
	if (text === "") return { start: 0, end: 0, text: inserted };
	if (lines.length > 0) {
		if (end > start) return { start: offsetOf(start), end: offsetOf(end) - 1, text: inserted };
		if (start < existing.length) return { start: offsetOf(start), end: offsetOf(start), text: `${inserted}\n` };
		return { start: text.length, end: text.length, text: `\n${inserted}` };
	}
	if (end < existing.length) return { start: offsetOf(start), end: offsetOf(end), text: "" };
	if (start > 0) return { start: offsetOf(start) - 1, end: text.length, text: "" };
	return { start: 0, end: text.length, text: "" };
}

/** Remaining conflicts come first; once none is left, every block that differs from either side. */
export function navigationTargets(result: string[], oldHunks: Hunk[], newHunks: Hunk[]): NavigationTargets {
	const conflicts = findConflicts(result);
	if (conflicts.length > 0) return { kind: "conflict", ranges: conflicts.map((conflict) => ({ start: conflict.start, end: conflict.end + 1 })) };
	const ranges = [...oldHunks, ...newHunks].map((hunk) => ({ start: hunk.resultStart, end: hunk.resultEnd })).sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: LineRange[] = [];
	for (const range of ranges) {
		const last = merged.at(-1);
		if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
		else merged.push({ ...range });
	}
	return { kind: "difference", ranges: merged };
}
