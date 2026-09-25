import { describe, expect, it } from "vitest";
import {
  assertAbsoluteSafePath,
  assertDeletionConfirmed,
  assertHttpsUrl,
  assertSeparateTrees,
  calculateRequiredFreeBytes,
  inspectArchiveEntries,
} from "./deployment-policy";

describe("deployment policy", () => {
  it("accepts a root-level GTNH archive", () => {
    expect(() => inspectArchiveEntries([
      "config/example.cfg",
      "mods/example.jar",
      "server.properties",
    ], ["-", "-", "-"])).not.toThrow();
  });

  it("rejects an archive wrapped in a parent directory", () => {
    expect(() => inspectArchiveEntries([
      "GTNH/config/example.cfg",
      "GTNH/mods/example.jar",
      "GTNH/server.properties",
    ], ["-", "-", "-"])).toThrow("Required root entry");
  });

  it.each(["../escape", "/absolute", "config\\escape.cfg"])("rejects unsafe entry %s", (entry) => {
    expect(() => inspectArchiveEntries([
      entry,
      "config/example.cfg",
      "mods/example.jar",
      "server.properties",
    ], ["-", "-", "-", "-"])).toThrow("Unsafe ZIP entries");
  });

  it("accepts entries without Unix type bits from Windows-made archives", () => {
    expect(() => inspectArchiveEntries([
      "config/example.cfg",
      "mods/example.jar",
      "server.properties",
    ], ["?", "?", "?"])).not.toThrow();
  });

  it("rejects symbolic links", () => {
    expect(() => inspectArchiveEntries([
      "config/example.cfg",
      "mods/example.jar",
      "server.properties",
    ], ["-", "l", "-"])).toThrow("symbolic link");
  });

  it("rejects an incomplete entry type listing", () => {
    expect(() => inspectArchiveEntries([
      "config/example.cfg",
      "mods/example.jar",
      "server.properties",
    ], ["-", "-"])).toThrow("every ZIP entry type");
  });

  it("rejects root and overlapping server paths", () => {
    expect(() => assertAbsoluteSafePath("/", "Destination")).toThrow("filesystem root");
    expect(() => assertAbsoluteSafePath("/", "Browser path", true)).not.toThrow();
    expect(() => assertSeparateTrees("/srv/gtnh", "/srv/gtnh/new")).toThrow("contain");
    expect(() => assertSeparateTrees("/srv/old", "/srv/new")).not.toThrow();
  });

  it("requires exact confirmation only for a non-empty destination", () => {
    expect(() => assertDeletionConfirmed(true, "/srv/new", "/srv/NEW")).toThrow("exact");
    expect(() => assertDeletionConfirmed(true, "/srv/new", "/srv/new")).not.toThrow();
    expect(() => assertDeletionConfirmed(false, "/srv/new")).not.toThrow();
  });

  it("adds ten percent disk margin", () => {
    expect(calculateRequiredFreeBytes(100)).toBe(110);
  });

  it("accepts public HTTPS URLs only", () => {
    expect(assertHttpsUrl("https://example.test/server.zip").href).toBe("https://example.test/server.zip");
    expect(() => assertHttpsUrl("http://example.test/server.zip")).toThrow("public HTTPS");
    expect(() => assertHttpsUrl("https://token@example.test/server.zip")).toThrow("public HTTPS");
  });
});
