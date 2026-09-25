import { describe, expect, it } from "vite-plus/test";
import {
	DEFAULT_EXCLUSIONS,
	classifyTrees,
	createExclusionMatcher,
	describeBaseMismatch,
	detectContentKind,
	formatText,
	mergeThreeWay,
	parseHashListing,
	parseText,
} from "./merge-policy";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

describe("exclusion matcher", () => {
	const isExcluded = createExclusionMatcher([...DEFAULT_EXCLUSIONS, "/World/"]);

	it.each([
		"mods/gregtech.jar",
		"libraries/net/minecraft/launchwrapper.jar",
		"forge-universal.jar",
		"logs/latest.log",
		"crash-reports/crash.txt",
		"backups/2026.zip",
		"config/.cache/index",
		"config/journeymap.tmp",
		"World/level.dat",
		"server.zip",
		"World-20260912-175312.zip",
		".healer.log",
		"coretweaks/cache/classTransformerLite.cache",
		"coretweaks/out/transformercache_profiler.csv",
		"GregTech.lang",
	])("excludes %s", (path) => {
		expect(isExcluded(path)).toBe(true);
	});

	it.each([
		"config/mods/settings.cfg",
		"config/GregTech/GregTech.cfg",
		"server.properties",
		"serverutilities/serverutilities.cfg",
		"OtherWorld/readme.txt",
		"config/guidenh/DefaultGuide.zip",
		"coretweaks/coretweaks.cfg",
	])("keeps %s", (path) => {
		expect(isExcluded(path)).toBe(false);
	});

	it("supports user glob patterns", () => {
		const matcher = createExclusionMatcher(["config/betterquesting/**", "*.png"]);
		expect(matcher("config/betterquesting/DefaultQuests/q.json")).toBe(true);
		expect(matcher("journeymap/icon/a.png")).toBe(true);
		expect(matcher("config/betterquesting.cfg")).toBe(false);
	});

	it("rejects parent traversal patterns", () => {
		expect(() => createExclusionMatcher(["../secret"])).toThrow("Invalid exclusion");
	});
});

describe("classification", () => {
	const tree = (entries: Record<string, string>): Map<string, string> => new Map(Object.entries(entries));

	it("proposes only user changes and leaves version changes to the new server", () => {
		const result = classifyTrees(
			tree({
				"unchanged.cfg": HASH_A,
				"version-only.cfg": HASH_A,
				"user-only.cfg": HASH_B,
				"both.cfg": HASH_B,
				"same-change.cfg": HASH_B,
				"removed.cfg": HASH_B,
				"removed-untouched.cfg": HASH_A,
				"added.cfg": HASH_A,
				"serverutilities/server/ranks.txt": HASH_A,
				"journeymap/config/5.2/journeymap.cfg": HASH_A,
				"added-both.cfg": HASH_A,
				"added-identical.cfg": HASH_A,
			}),
			tree({
				"unchanged.cfg": HASH_A,
				"version-only.cfg": HASH_A,
				"user-only.cfg": HASH_A,
				"both.cfg": HASH_A,
				"same-change.cfg": HASH_A,
				"removed.cfg": HASH_A,
				"removed-untouched.cfg": HASH_A,
				"deleted-by-user.cfg": HASH_A,
			}),
			tree({
				"unchanged.cfg": HASH_A,
				"version-only.cfg": HASH_C,
				"user-only.cfg": HASH_A,
				"both.cfg": HASH_C,
				"same-change.cfg": HASH_B,
				"deleted-by-user.cfg": HASH_A,
				"added-both.cfg": HASH_B,
				"added-identical.cfg": HASH_A,
			})
		);

		expect(result.files).toEqual([
			{ path: "added-both.cfg", kind: "conflict" },
			// Created outside the folders whose data is carried over: a mod will recreate it.
			{ path: "added.cfg", kind: "mod-added" },
			{ path: "both.cfg", kind: "conflict" },
			{ path: "journeymap/config/5.2/journeymap.cfg", kind: "user-added" },
			{ path: "removed.cfg", kind: "removed-by-new" },
			{ path: "serverutilities/server/ranks.txt", kind: "user-added" },
			{ path: "user-only.cfg", kind: "user-modified" },
		]);
		expect(result.comparedBaseFiles).toBe(7);
		expect(result.userChangedBaseFiles).toBe(4);
	});

	it("warns when the original archive does not look like the old installation", () => {
		expect(describeBaseMismatch(0, 0)).toMatch("No file");
		expect(describeBaseMismatch(10, 6)).toMatch("60%");
		expect(describeBaseMismatch(10, 5)).toBeUndefined();
	});
});

describe("checksum listing", () => {
	it("parses sha256sum output and applies exclusions", () => {
		const output = `${HASH_A}  ./config/a.cfg\n${HASH_B}  ./mods/b.jar\n${HASH_C}  ./name with spaces.txt\n`;
		const hashes = parseHashListing(output, createExclusionMatcher(DEFAULT_EXCLUSIONS));
		expect([...hashes]).toEqual([
			["config/a.cfg", HASH_A],
			["name with spaces.txt", HASH_C],
		]);
	});

	it("rejects escaped file names", () => {
		expect(() => parseHashListing(`\\${HASH_A}  ./bad\\nname\n`, () => false)).toThrow("special characters");
	});
});

describe("content handling", () => {
	it("detects binary, non UTF-8 and large files", () => {
		expect(detectContentKind(Buffer.from("key=value\n"))).toBe("text");
		expect(detectContentKind(Buffer.from([0x50, 0x00, 0x4b]))).toBe("binary");
		expect(detectContentKind(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe("non-utf8");
		expect(detectContentKind(Buffer.alloc(2 * 1024 * 1024 + 1, 0x61))).toBe("large");
	});

	it("round-trips BOM, CRLF and final newline", () => {
		const source = Buffer.from("\uFEFFa=1\r\nb=2\r\n", "utf8");
		const parsed = parseText(source);
		expect(parsed.lines).toEqual(["a=1", "b=2"]);
		expect(parsed.format).toEqual({ bom: true, eol: "\r\n", finalNewline: true });
		expect(formatText(parsed.lines, parsed.format).equals(source)).toBe(true);
	});

	it("keeps a missing final newline", () => {
		const parsed = parseText(Buffer.from("a\nb"));
		expect(formatText(parsed.lines, parsed.format).toString()).toBe("a\nb");
	});
});

describe("three-way merge", () => {
	const base = ["a", "b", "c", "d", "e", "f", "g"];

	it("applies one-sided changes from both versions", () => {
		const blocks = mergeThreeWay(base, ["a", "B", "c", "d", "e", "f", "g"], ["a", "b", "c", "d", "e", "F", "g", "h"]);
		expect(blocks).toEqual([
			{ type: "stable", lines: ["a"] },
			{ type: "resolved", source: "old", lines: ["B"] },
			{ type: "stable", lines: ["c", "d", "e"] },
			{ type: "resolved", source: "new", lines: ["F"] },
			{ type: "stable", lines: ["g"] },
			{ type: "resolved", source: "new", lines: ["h"] },
		]);
	});

	it("reports overlapping changes as a conflict", () => {
		const blocks = mergeThreeWay(base, ["a", "b", "OLD", "d", "e", "f", "g"], ["a", "b", "NEW", "d", "e", "f", "g"]);
		expect(blocks).toContainEqual({ type: "conflict", id: 0, base: ["c"], old: ["OLD"], new: ["NEW"] });
	});

	it("accepts identical changes from both sides", () => {
		const blocks = mergeThreeWay(base, ["a", "X", "c", "d", "e", "f", "g"], ["a", "X", "c", "d", "e", "f", "g"]);
		expect(blocks).toContainEqual({ type: "resolved", source: "both", lines: ["X"] });
	});

	it("treats files added on both sides as a conflict against an empty base", () => {
		expect(mergeThreeWay([], ["old"], ["new"])).toEqual([{ type: "conflict", id: 0, base: [], old: ["old"], new: ["new"] }]);
	});
});
