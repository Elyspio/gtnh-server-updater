import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORLD_DATA_PATTERNS,
  assertSameStats,
  parseAdditionalBackupFiles,
  parseLevelName,
  parseTreeStats,
  replaceLevelName,
  resolveDataGlobs,
  splitGlob,
} from "./migration-policy";

const SERVERUTILITIES_CFG = `backups {
    S:additional_backup_files <
        journeymap/data/sp/$WORLDNAME/**
        TCNodeTracker/$WORLDNAME/**
        saves/NEI/global/**
        saves/NEI/local/$WORLDNAME/**
        visualprospecting/client/*/$WORLDNAME_*/**
        visualprospecting/server/$WORLDNAME_*/**
     >
    S:backup_folder_path=./backups/
}`;

describe("level-name", () => {
  it("reads the old world name", () => {
    expect(parseLevelName("#comment\nmotd=x\nlevel-name=My World\r\n")).toBe("My World");
    expect(parseLevelName("level-name : Survival")).toBe("Survival");
  });

  it.each(["", "level-name=", "level-name=../escape", "level-name=a/b"])("rejects %j", (content) => {
    expect(() => parseLevelName(content)).toThrow();
  });

  it("rewrites only the level-name line", () => {
    expect(replaceLevelName("a=1\r\nlevel-name=World\r\nb=2\r\n", "Survival")).toBe("a=1\r\nlevel-name=Survival\r\nb=2\r\n");
    expect(replaceLevelName("a=1\n", "Survival")).toBe("a=1\nlevel-name=Survival\n");
  });
});

describe("world data outside the world folder", () => {
  it("reads serverutilities backup paths", () => {
    expect(parseAdditionalBackupFiles(SERVERUTILITIES_CFG)).toHaveLength(6);
    expect(parseAdditionalBackupFiles("backups {\n}")).toBeUndefined();
  });

  it("keeps server-side paths only and substitutes the world name", () => {
    expect(resolveDataGlobs(parseAdditionalBackupFiles(SERVERUTILITIES_CFG)!, "World")).toEqual([
      "journeymap/data/sp/World",
      "TCNodeTracker/World",
      "visualprospecting/server/World_*",
    ]);
    expect(resolveDataGlobs(DEFAULT_WORLD_DATA_PATTERNS, "World")).toHaveLength(3);
  });

  it("rejects paths escaping the server", () => {
    expect(() => resolveDataGlobs(["../outside/**"], "World")).toThrow("Unsupported");
    expect(() => resolveDataGlobs(["/etc/**"], "World")).toThrow("Unsupported");
  });

  it("splits globs for a bounded server-side search", () => {
    const glob = splitGlob("visualprospecting/server/World_*");
    expect(glob.prefix).toBe("visualprospecting/server");
    expect(glob.depth).toBe(1);
    expect(glob.expression.test("visualprospecting/server/World_0_overworld")).toBe(true);
    expect(glob.expression.test("visualprospecting/server/Other_0")).toBe(false);
    expect(splitGlob("TCNodeTracker/World")).toMatchObject({ prefix: "TCNodeTracker/World", depth: 0 });
  });
});

describe("copy verification", () => {
  it("compares file count and bytes", () => {
    expect(parseTreeStats("12 3400\n")).toEqual({ files: 12, bytes: 3400 });
    expect(() => assertSameStats("World", { files: 2, bytes: 10 }, { files: 2, bytes: 10 })).not.toThrow();
    expect(() => assertSameStats("World", { files: 2, bytes: 10 }, { files: 1, bytes: 10 })).toThrow("verification failed");
  });
});
