import { describe, expect, it } from "vitest";
import type { MergeBlock } from "./merge.types";
import {
  CONFLICT_END,
  CONFLICT_SEPARATOR,
  CONFLICT_START,
  buildMergedText,
  defaultDecisions,
  groupByDirectory,
  hasConflictMarkers,
  isCarriedOverAddition,
} from "./merge-model";

describe("merge model", () => {
  it("takes your edits by default, proposes the rest unchecked and leaves conflicts undecided", () => {
    const decisions = defaultDecisions([
      { path: "a.cfg", kind: "user-modified" },
      { path: "serverutilities/server/ranks.txt", kind: "user-added" },
      { path: "c.cfg", kind: "removed-by-new" },
      { path: "d.cfg", kind: "conflict" },
      { path: "e.cfg", kind: "regenerated" },
      { path: "config/made-by-a-mod.json", kind: "mod-added" },
    ]);
    expect([...decisions.values()]).toEqual([
      { path: "a.cfg", action: "take-old" },
      { path: "serverutilities/server/ranks.txt", action: "take-old" },
      { path: "c.cfg", action: "keep-new" },
      { path: "e.cfg", action: "keep-new" },
      { path: "config/made-by-a-mod.json", action: "keep-new" },
    ]);
  });

  it("keeps one-sided changes and marks the conflicting ones", () => {
    const blocks: MergeBlock[] = [
      { type: "stable", lines: ["a"] },
      { type: "resolved", source: "old", lines: ["user"] },
      { type: "conflict", id: 0, base: ["b"], old: ["old"], new: ["new"] },
    ];
    const merged = buildMergedText(blocks);
    expect(merged.split("\n")).toEqual(["a", "user", CONFLICT_START, "old", CONFLICT_SEPARATOR, "new", CONFLICT_END]);
    expect(hasConflictMarkers(merged)).toBe(true);
    expect(hasConflictMarkers(buildMergedText(blocks.slice(0, 2)))).toBe(false);
  });

  it("carries over additions only under the folders that hold kept data", () => {
    expect(isCarriedOverAddition("serverutilities/server/ranks.txt")).toBe(true);
    expect(isCarriedOverAddition("journeymap/data/x.json")).toBe(true);
    expect(isCarriedOverAddition("config/AppliedEnergistics2/a.json")).toBe(false);
  });

  it("groups files by parent directory", () => {
    expect(groupByDirectory([
      { path: "server.properties", kind: "user-modified" },
      { path: "config/a.cfg", kind: "conflict" },
      { path: "config/b.cfg", kind: "user-added" },
    ]).map((group) => [group.directory, group.files.length])).toEqual([["/", 1], ["config", 2]]);
  });
});
