import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { assertJarFileName, assertSafeModId, parseModInfo, singleMod } from "./mod-info";
import { matchMod, parseScannedJars, JAR_MARKER } from "./mod-match";
import { readZipEntry } from "./zip-entry";
import { makeZip, modInfoJson } from "./zip-fixture";

describe("mcmod.info", () => {
	it("reads both the list and the modListVersion 2 formats", () => {
		expect(parseModInfo(modInfoJson("matter-manipulator", "0.2.2", "Matter Manipulator"))).toEqual([
			{ modId: "matter-manipulator", name: "Matter Manipulator", version: "0.2.2" },
		]);
		expect(parseModInfo('﻿[{"modid":"a","version":"1"},{"modid":"b"},{"modid":"a"}]')).toEqual([
			{ modId: "a", version: "1", name: undefined },
			{ modId: "b", name: undefined, version: undefined },
		]);
	});

	it("still finds modids in a file that is not strict JSON", () => {
		expect(parseModInfo('[{ "modid": "gregtech", "version": "${version}", }]').map((mod) => mod.modId)).toEqual(["gregtech"]);
		expect(parseModInfo("not json at all")).toEqual([]);
	});

	it("accepts only single-mod JARs with a plain modid and file name", () => {
		expect(singleMod([{ modId: "x" }], "x.jar").modId).toBe("x");
		expect(() => singleMod([], "x.jar")).toThrow("no mcmod.info modid");
		expect(() => singleMod([{ modId: "a" }, { modId: "b" }], "x.jar")).toThrow("several mods");
		expect(() => assertSafeModId("../etc")).toThrow("Unsupported modid");
		expect(() => assertSafeModId("..")).toThrow("Unsupported modid");
		expect(assertJarFileName("matter-manipulator-0.2.2.jar")).toBe("matter-manipulator-0.2.2.jar");
		expect(() => assertJarFileName(".hidden.jar")).toThrow();
		expect(() => assertJarFileName("a/b.jar")).toThrow();
		expect(() => assertJarFileName("notes.txt")).toThrow();
	});
});

describe("mod lookup", () => {
	it("reads one entry of a JAR without the rest", async () => {
		const file = path.join(mkdtempSync(path.join(os.tmpdir(), "gtnh-zip-")), "mod.jar");
		writeFileSync(file, makeZip({ "a/Big.class": Buffer.alloc(200_000, 7), "mcmod.info": modInfoJson("x", "1") }));
		expect((await readZipEntry(file, "mcmod.info"))?.toString()).toBe(modInfoJson("x", "1"));
		expect(await readZipEntry(file, "missing")).toBeUndefined();
		await expect(readZipEntry(file, "a/Big.class", 1000)).rejects.toThrow("larger than");

		const broken = `${file}.broken`;
		writeFileSync(broken, "not a zip file at all, really not");
		await expect(readZipEntry(broken, "mcmod.info")).rejects.toThrow("Not a ZIP file");
	});

	it("needs exactly one JAR for the modid in mods/ and mods/1.7.10/", () => {
		const output = [
			"",
			`${JAR_MARKER}mods/a.jar`,
			modInfoJson("alpha", "1"),
			`${JAR_MARKER}mods/1.7.10/b.jar`,
			modInfoJson("beta", "2"),
			`${JAR_MARKER}mods/coremod.jar`,
			`${JAR_MARKER}mods/c.jar`,
			modInfoJson("beta", "3"),
		].join("\n");
		const jars = parseScannedJars(output);
		expect(jars.map((jar) => jar.relativePath)).toEqual(["mods/a.jar", "mods/1.7.10/b.jar", "mods/coremod.jar", "mods/c.jar"]);
		expect(matchMod(jars, "alpha")).toMatchObject({ status: "found", version: "1", jar: { relativePath: "mods/a.jar" } });
		expect(matchMod(jars, "beta")).toEqual({ status: "ambiguous", files: ["mods/1.7.10/b.jar", "mods/c.jar"] });
		expect(matchMod(jars, "gamma")).toEqual({ status: "absent" });
	});
});
