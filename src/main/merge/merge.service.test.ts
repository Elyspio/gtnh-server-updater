import { describe, expect, it } from "vite-plus/test";
import type { MergeFileEntry } from "@shared/merge.types";
import { validateDecisions } from "./merge.service";

const files = new Map<string, MergeFileEntry>([
	["config/user.cfg", { path: "config/user.cfg", kind: "user-modified" }],
	["config/both.cfg", { path: "config/both.cfg", kind: "conflict" }],
	["config/binary.dat", { path: "config/binary.dat", kind: "conflict" }],
]);
const newTextFormats = new Map([["config/both.cfg", { bom: false, eol: "\n" as const, finalNewline: true }]]);

describe("merge decisions", () => {
	it("accepts edited results for reviewed files changed only by the user", () => {
		const path = "config/GregTech/GregTech.cfg";
		expect(() =>
			validateDecisions(
				{
					files: new Map([[path, { path, kind: "user-modified" }]]),
					newTextFormats: new Map([[path, { bom: false, eol: "\n", finalNewline: true }]]),
				},
				[{ path, action: "write", lines: ["B:enabled=false"] }]
			)
		).not.toThrow();
	});

	it("accepts a reviewed decision for every conflict", () => {
		expect(() =>
			validateDecisions({ files, newTextFormats }, [
				{ path: "config/user.cfg", action: "take-old" },
				{ path: "config/both.cfg", action: "write", lines: ["a=1"] },
				{ path: "config/binary.dat", action: "keep-new" },
			])
		).not.toThrow();
	});

	it("blocks application while a conflict is unreviewed", () => {
		expect(() => validateDecisions({ files, newTextFormats }, [{ path: "config/both.cfg", action: "keep-new" }])).toThrow("1 conflicting files");
	});

	it("rejects paths outside the prepared merge", () => {
		expect(() => validateDecisions({ files, newTextFormats }, [{ path: "../outside", action: "take-old" }])).toThrow("not part of this merge");
	});

	it("writes merged text only for files loaded as text", () => {
		expect(() =>
			validateDecisions({ files, newTextFormats }, [
				{ path: "config/user.cfg", action: "write", lines: [] },
				{ path: "config/both.cfg", action: "keep-new" },
				{ path: "config/binary.dat", action: "keep-new" },
			])
		).toThrow("reviewed text file");
		expect(() =>
			validateDecisions({ files, newTextFormats }, [
				{ path: "config/both.cfg", action: "keep-new" },
				{ path: "config/binary.dat", action: "write", lines: [] },
			])
		).toThrow("reviewed text file");
	});

	it("rejects duplicate decisions", () => {
		expect(() =>
			validateDecisions({ files, newTextFormats }, [
				{ path: "config/both.cfg", action: "keep-new" },
				{ path: "config/both.cfg", action: "take-old" },
			])
		).toThrow("Duplicate");
	});
});
