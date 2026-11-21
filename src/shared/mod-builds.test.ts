import { describe, expect, it } from "vite-plus/test";
import { latestPerRelease, releaseOf } from "./mod-builds";
import type { ModJar } from "./mods.types";

const jar = (fileName: string, version: string | undefined, modifiedAt: number, sha256 = fileName): ModJar => ({
	path: `/libs/${fileName}`,
	fileName,
	modId: "matter-manipulator",
	version,
	sizeBytes: 1,
	modifiedAt,
	sha256,
});

describe("mod builds", () => {
	it("reads the release from a gradle-decorated version", () => {
		expect(releaseOf(jar("a.jar", "0.2.2-GTNH-feat-portable-blueprints.1+7b65685991-dirty", 0))).toBe("0.2.2");
		expect(releaseOf(jar("a.jar", undefined, 0))).toBe("no version");
	});

	it("keeps the newest build of each release, newest release first", () => {
		const releases = latestPerRelease([
			jar("mm-0.2.1-review-fixes.jar", "0.2.1-GTNH-master+51ef032bde-dirty", 10, "x"),
			jar("mm-0.2.1-GTNH-master.jar", "0.2.1-GTNH-master+51ef032bde-dirty", 10, "x"),
			jar("mm-0.2.1-fix-enderio.jar", "0.2.1-GTNH-master+51ef032bde-dirty", 5, "y"),
			jar("mm-0.2.2-multiparts.jar", "0.2.2-GTNH-feat+7b65685991-dirty", 30, "z"),
			jar("mm-0.2.2-GTNH-feat.jar", "0.2.2-GTNH-feat+7b65685991-dirty", 30, "z"),
			jar("mm-0.2.2-ui.jar", "0.2.2-GTNH-feat+7b65685991-dirty", 20, "u"),
			jar("mm-0.2.10.jar", "0.2.10", 1),
		]);
		expect(releases.map((release) => [release.release, release.jar.sha256, release.otherBuilds])).toEqual([
			["0.2.10", "mm-0.2.10.jar", 0],
			["0.2.2", "z", 1],
			["0.2.1", "x", 1],
		]);
	});
});
