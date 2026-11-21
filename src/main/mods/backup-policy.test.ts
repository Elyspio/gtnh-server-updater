import { createHash } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import type { ModBackup } from "@shared/mods.types";
import { backupsToPrune, chainStart, isBackupId, newBackupId, parseBackupRecord, restoreSource } from "./backup-policy";
import { assessBoot, parseObservation, type BootObservation, type BootTracker } from "./boot-check";

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");

function backup(id: number, original: string, installed: string): ModBackup {
	return {
		id: `2026112${id}T000000000Z`,
		record: {
			version: 1,
			modId: "mm",
			originalFile: "mods/mm.jar",
			originalSha256: sha(original),
			installedFile: "mods/mm-custom.jar",
			installedSha256: sha(installed),
			createdAt: "2026-11-21T00:00:00.000Z",
		},
	};
}

describe("mod backups", () => {
	it("names backups so they sort by date", () => {
		const id = newBackupId(new Date("2026-11-21T15:07:00.123Z"));
		expect(id).toBe("20261121T150700123Z");
		expect(isBackupId(id)).toBe(true);
		expect(isBackupId("../x")).toBe(false);
	});

	it("restores the original of the current chain, only over the JAR installed last", () => {
		// GTNH original o, then custom a, then custom b over a.
		const chain = [backup(1, "o", "a"), backup(2, "a", "b")];
		expect(chainStart(chain)).toBe(0);
		expect(restoreSource(chain, sha("b"))?.id).toBe(chain[0]!.id);
		expect(restoreSource(chain, sha("a"))).toBeUndefined();
		expect(restoreSource([], sha("b"))).toBeUndefined();

		// A new GTNH version n replaced the JAR in between: older backups belong to another version.
		const updated = [...chain, backup(3, "n", "c")];
		expect(chainStart(updated)).toBe(2);
		expect(restoreSource(updated, sha("c"))?.id).toBe(updated[2]!.id);
	});

	it("keeps the chain original and the four most recent backups", () => {
		const long = [backup(1, "o", "a"), backup(2, "a", "b"), backup(3, "b", "c"), backup(4, "c", "d"), backup(5, "d", "e"), backup(6, "e", "f")];
		expect(backupsToPrune(long).map((entry) => entry.id)).toEqual([long[1]!.id]);
		const withOldChain = [backup(1, "x", "y"), backup(2, "o", "a"), backup(3, "a", "b")];
		expect(backupsToPrune(withOldChain).map((entry) => entry.id)).toEqual([]);
		const oldChainBeyondRecent = [backup(1, "x", "y"), backup(2, "o", "a"), backup(3, "a", "b"), backup(4, "b", "c"), backup(5, "c", "d"), backup(6, "d", "e")];
		expect(backupsToPrune(oldChainBeyondRecent).map((entry) => entry.id)).toEqual([oldChainBeyondRecent[0]!.id]);
	});

	it("rejects damaged or escaping records", () => {
		const valid = backup(1, "o", "a").record;
		expect(parseBackupRecord(JSON.stringify(valid))).toEqual(valid);
		expect(() => parseBackupRecord(JSON.stringify({ ...valid, installedFile: "mods/../../etc/passwd.jar" }))).toThrow();
		expect(() => parseBackupRecord(JSON.stringify({ ...valid, originalFile: "config/x.jar" }))).toThrow();
		expect(() => parseBackupRecord(JSON.stringify({ ...valid, originalSha256: "zz" }))).toThrow();
	});
});

describe("server start check", () => {
	const observation = (overrides: Partial<BootObservation>): BootObservation => ({
		logInode: "100",
		serviceState: "active",
		started: false,
		exception: false,
		crashReports: ["crash-old.txt"],
		...overrides,
	});
	const tracker = (): BootTracker => ({ baseline: observation({ started: true }), startedAt: 0 });

	it("ignores the previous run's log and waits for the new one", () => {
		const state = tracker();
		expect(assessBoot(state, observation({ started: true }), 5000)).toEqual({ status: "pending" });
		expect(assessBoot(state, observation({ logInode: "200" }), 10_000)).toEqual({ status: "pending" });
		expect(assessBoot(state, observation({ logInode: "200", started: true }), 15_000)).toEqual({ status: "started" });
	});

	it("fails on a crash report, an exception, a relaunch, a dead service or a timeout", () => {
		expect(assessBoot(tracker(), observation({ crashReports: ["crash-old.txt", "crash-new.txt"] }), 1)).toMatchObject({ status: "failed", crashReport: "crash-new.txt" });
		expect(assessBoot(tracker(), observation({ logInode: "200", exception: true }), 1)).toMatchObject({
			status: "failed",
			reason: expect.stringContaining("unexpected exception"),
		});

		const relaunched = tracker();
		expect(assessBoot(relaunched, observation({ logInode: "200" }), 1).status).toBe("pending");
		expect(assessBoot(relaunched, observation({ logInode: "300" }), 2)).toMatchObject({ status: "failed", reason: expect.stringContaining("relaunched") });

		expect(assessBoot(tracker(), observation({ serviceState: "failed" }), 1)).toMatchObject({ status: "failed", reason: "The service is failed" });
		expect(assessBoot(tracker(), observation({}), 11 * 60 * 1000)).toMatchObject({ status: "failed", reason: expect.stringContaining("10 minutes") });
	});

	it("parses one poll of the server", () => {
		expect(parseObservation("4242\nactive\n1\n0\ncrash-a.txt\ncrash-b.txt\n")).toEqual({
			logInode: "4242",
			serviceState: "active",
			started: true,
			exception: false,
			crashReports: ["crash-a.txt", "crash-b.txt"],
		});
		expect(parseObservation("\ninactive\n0\n0\n")).toEqual({ logInode: "", serviceState: "inactive", started: false, exception: false, crashReports: [] });
	});
});

describe("remote backup listing", () => {
	it("reads each record through a braced variable, not $dinstalled", async () => {
		const { backupRecordsScript } = await import("./server-mods");
		const script = backupRecordsScript("'/srv/mods-backup/mm'/*/");
		expect(script).toContain('[ -f "${d}installed.json" ]');
		expect(script).toContain('head -c 65536 "${d}installed.json"');
	});
});
