/** Calls the real GitHub API; run with GTNH_NETWORK_TESTS=1. */
import { describe, expect, it } from "vite-plus/test";
import { listGtnhReleases, readLatestVersions } from "./gtnh-releases";

describe.skipIf(!process.env.GTNH_NETWORK_TESTS)("GTNH daily builds", () => {
	it("lists recent builds with their server archive", async () => {
		const releases = await listGtnhReleases();
		expect(releases.length).toBeGreaterThan(5);
		expect(releases.length).toBeLessThanOrEqual(50);

		const [latest] = releases;
		expect(latest!.tag).toMatch(/^daily-\d{4}-\d{2}-\d{2}\+\d+$/);
		expect(latest!.recommended?.name).toMatch(/server.*java17.*\.zip$/i);
		expect(latest!.recommended?.url).toMatch(/^https:\/\/github\.com\/GTNewHorizons\/GTNH-Daily-Builds\/releases\/download\//);
		expect(latest!.recommended!.size).toBeGreaterThan(100_000_000);
		console.log(`latest: ${latest!.tag} -> ${latest!.recommended?.name}`);
	}, 30_000);

	it("reads the newest daily build and the newest modpack version", async () => {
		const versions = await readLatestVersions();
		expect(versions.dailyBuild?.tag).toMatch(/^daily-\d{4}-\d{2}-\d{2}\+\d+$/);
		expect(versions.modpack?.tag).toMatch(/^\d+\.\d+/);
		console.log(`latest: ${versions.modpack?.tag} · ${versions.dailyBuild?.tag}`);
	}, 30_000);
});
