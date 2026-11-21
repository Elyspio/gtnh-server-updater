import { describe, expect, it } from "vite-plus/test";
import { CONFLICT_END, CONFLICT_SEPARATOR, CONFLICT_START } from "./merge-model";
import { alignmentFillers, findConflicts, navigationTargets, replaceLines, sideHunks } from "./merge-review";

const conflicted = ["a", CONFLICT_START, "old", CONFLICT_SEPARATOR, "new", CONFLICT_END, "z"];

function apply(text: string, edit: { start: number; end: number; text: string }): string {
	return text.slice(0, edit.start) + edit.text + text.slice(edit.end);
}

describe("merge review", () => {
	it("finds complete conflict blocks only", () => {
		expect(findConflicts([...conflicted, CONFLICT_START, "dangling"])).toEqual([{ start: 1, separator: 3, end: 5 }]);
	});

	it("reports the blocks where one side differs from the result", () => {
		expect(sideHunks(["a", "b", "c", "d"], ["a", "B", "c", "d", "e"], "old")).toEqual([
			{ sideStart: 1, sideEnd: 2, resultStart: 1, resultEnd: 2 },
			{ sideStart: 4, sideEnd: 4, resultStart: 4, resultEnd: 5 },
		]);
		expect(sideHunks(["a", "b"], ["b"], "old")).toEqual([{ sideStart: 0, sideEnd: 1, resultStart: 0, resultEnd: 0 }]);
	});

	it("covers a whole conflict block with one hunk per side", () => {
		expect(sideHunks(["a", "old", "z"], conflicted, "old")).toEqual([{ sideStart: 1, sideEnd: 2, resultStart: 1, resultEnd: 6 }]);
		expect(sideHunks(["a", "new", "z"], conflicted, "new")).toEqual([{ sideStart: 1, sideEnd: 2, resultStart: 1, resultEnd: 6 }]);
	});

	it("keeps a change merged next to a conflict out of the conflict hunk", () => {
		const result = ["a", CONFLICT_START, "old", CONFLICT_SEPARATOR, "new", CONFLICT_END, "B"];
		expect(sideHunks(["a", "old", "b"], result, "old")).toEqual([
			{ sideStart: 1, sideEnd: 2, resultStart: 1, resultEnd: 6 },
			{ sideStart: 2, sideEnd: 3, resultStart: 6, resultEnd: 7 },
		]);
	});

	it("gives an empty conflict section its own hunk", () => {
		const result = ["a", CONFLICT_START, CONFLICT_SEPARATOR, "new", CONFLICT_END, "z"];
		expect(sideHunks(["a", "z"], result, "old")).toEqual([{ sideStart: 1, sideEnd: 1, resultStart: 1, resultEnd: 5 }]);
	});

	it("pads the shorter panes so every block has the same height", () => {
		const result = ["a", "x", "y", "c", "d"];
		const oldHunks = sideHunks(["a", "b", "c", "d"], result, "old");
		const newHunks = sideHunks(["a", "x", "y", "c", "n1", "n2", "n3", "d"], result, "new");
		expect(alignmentFillers(oldHunks, newHunks)).toEqual({
			old: [
				{ afterLine: 2, lines: 1 },
				{ afterLine: 3, lines: 3 },
			],
			result: [{ afterLine: 4, lines: 3 }],
			new: [],
		});
	});

	it("needs no filler when the panes only differ line for line", () => {
		const result = ["a", "B", "c"];
		expect(alignmentFillers(sideHunks(["a", "b", "c"], result, "old"), sideHunks(["a", "b2", "c"], result, "new"))).toEqual({ old: [], result: [], new: [] });
	});

	it("replaces, inserts and deletes whole lines", () => {
		const text = "a\nb\nc";
		expect(apply(text, replaceLines(text, 1, 2, ["x", "y"]))).toBe("a\nx\ny\nc");
		expect(apply(text, replaceLines(text, 1, 1, ["x"]))).toBe("a\nx\nb\nc");
		expect(apply(text, replaceLines(text, 3, 3, ["x"]))).toBe("a\nb\nc\nx");
		expect(apply(text, replaceLines(text, 1, 2, []))).toBe("a\nc");
		expect(apply(text, replaceLines(text, 2, 3, []))).toBe("a\nb");
		expect(apply(text, replaceLines(text, 0, 3, []))).toBe("");
		expect(apply("", replaceLines("", 0, 1, ["x"]))).toBe("x");
	});

	it("navigates conflicts first, then every difference", () => {
		expect(navigationTargets(conflicted, [], [])).toEqual({ kind: "conflict", ranges: [{ start: 1, end: 6 }] });
		const result = ["a", "b", "c", "d"];
		const oldHunks = sideHunks(["a", "B", "c", "d"], result, "old");
		const newHunks = sideHunks(["a", "b", "C", "d", "e"], result, "new");
		expect(navigationTargets(result, oldHunks, newHunks)).toEqual({
			kind: "difference",
			ranges: [
				{ start: 1, end: 3 },
				{ start: 4, end: 4 },
			],
		});
	});
});
