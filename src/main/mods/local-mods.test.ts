import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { ModsProgress } from "@shared/mods.types";
import { isInstanceRunning } from "./java-processes";
import { defaultPrismDirectory, inspectLocal, listModJars, listPrismInstances, readModJar, replaceLocal, restoreLocal } from "./local-mods";
import { ModsService } from "./mods.service";
import { ModsSettingsStore } from "./mods-settings-store";
import { makeZip, modInfoJson } from "./zip-fixture";

function temporaryDirectory(): string {
	return mkdtempSync(path.join(os.tmpdir(), "gtnh-mods-"));
}

function writeJar(file: string, modId: string, version: string, filler = ""): string {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, makeZip({ "mcmod.info": modInfoJson(modId, version), "filler.txt": `${version}${filler}` }));
	return file;
}

/** A Prism instances folder with one instance holding the GTNH JAR. */
function prismWithInstance(name = "GTNH 2.9.0"): { prism: string; instance: string; minecraft: string } {
	const prism = temporaryDirectory();
	const instance = path.join(prism, "GTNH_2.9.0");
	const minecraft = path.join(instance, ".minecraft");
	mkdirSync(minecraft, { recursive: true });
	writeFileSync(path.join(instance, "instance.cfg"), `[General]\nInstanceType=OneSix\nname=${name}\n`);
	writeJar(path.join(minecraft, "mods", "matter-manipulator-0.1.75-GTNH.jar"), "matter-manipulator", "0.1.75");
	writeJar(path.join(minecraft, "mods", "other.jar"), "other", "1");
	return { prism, instance, minecraft };
}

describe("local mod JARs", () => {
	it("reads a chosen JAR and lists a folder's builds newest first", async () => {
		const folder = temporaryDirectory();
		const older = writeJar(path.join(folder, "mm-a.jar"), "matter-manipulator", "0.2.1");
		const newer = writeJar(path.join(folder, "mm-b.jar"), "matter-manipulator", "0.2.2");
		writeJar(path.join(folder, "other.jar"), "other", "1");
		writeFileSync(path.join(folder, "broken.jar"), "nope");
		writeJar(path.join(folder, "mm-b-dev.jar"), "matter-manipulator", "0.2.2");
		writeJar(path.join(folder, "mm-b-sources.jar"), "matter-manipulator", "0.2.2");
		utimesSync(older, new Date("2026-11-01"), new Date("2026-11-01"));
		utimesSync(newer, new Date("2026-11-20"), new Date("2026-11-20"));

		const jar = await readModJar(newer);
		expect(jar).toMatchObject({ fileName: "mm-b.jar", modId: "matter-manipulator", version: "0.2.2" });
		expect(jar.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect((await listModJars(folder, "matter-manipulator")).map((entry) => entry.fileName)).toEqual(["mm-b.jar", "mm-a.jar"]);
		await expect(readModJar(path.join(folder, "broken.jar"))).rejects.toThrow();
		await expect(readModJar(path.join(folder, "mm-b-dev.jar"))).rejects.toThrow("development, sources or API JAR");
	});

	it("finds Prism instances and their game folder", async () => {
		const { prism, instance } = prismWithInstance("My pack");
		mkdirSync(path.join(prism, "not-an-instance"));
		expect(await listPrismInstances(prism)).toEqual([{ id: "GTNH_2.9.0", name: "My pack", directory: instance, minecraftDirectory: path.join(instance, ".minecraft") }]);
		expect(defaultPrismDirectory({ APPDATA: path.join(prism, "missing") }, "win32")).toBe(path.join(prism, "missing", "PrismLauncher", "instances"));
	});

	it("detects a running instance from Java command lines, whatever the slashes", () => {
		const directory = "C:\\Users\\me\\AppData\\Roaming\\PrismLauncher\\instances\\GTNH";
		const line = "javaw.exe -Djava.library.path=C:/Users/me/AppData/Roaming/PrismLauncher/instances/GTNH/natives -cp x";
		expect(isInstanceRunning(directory, [line], "win32")).toBe(true);
		expect(isInstanceRunning(`${directory}2`, [line], "win32")).toBe(false);
		expect(isInstanceRunning(directory, [], "win32")).toBe(false);
	});

	it("replaces with a backup outside mods/, then restores the original", async () => {
		const { minecraft } = prismWithInstance();
		const original = path.join(minecraft, "mods", "matter-manipulator-0.1.75-GTNH.jar");
		const originalBytes = readFileSync(original);
		const custom = await readModJar(writeJar(path.join(temporaryDirectory(), "matter-manipulator-0.2.2-custom.jar"), "matter-manipulator", "0.2.2"));

		const before = await inspectLocal(minecraft, "matter-manipulator");
		expect(before.state).toMatchObject({ status: "ready", current: { relativePath: "mods/matter-manipulator-0.1.75-GTNH.jar", version: "0.1.75" } });
		expect(before.state.status === "ready" && before.state.restore).toBeUndefined();

		const replaced = await replaceLocal(minecraft, custom, before, new Date("2026-11-21T10:00:00Z"));
		expect(replaced.installedFile).toBe("mods/matter-manipulator-0.2.2-custom.jar");
		expect(readdirSync(path.join(minecraft, "mods")).sort()).toEqual(["matter-manipulator-0.2.2-custom.jar", "other.jar"]);
		expect(readFileSync(path.join(replaced.backupPath, "matter-manipulator-0.1.75-GTNH.jar"))).toEqual(originalBytes);
		expect(readdirSync(path.join(minecraft, "mods-backup")).filter((name) => name.startsWith(".incoming"))).toEqual([]);

		const after = await inspectLocal(minecraft, "matter-manipulator");
		expect(after.state).toMatchObject({ status: "ready", current: { version: "0.2.2" }, restore: { fileName: "matter-manipulator-0.1.75-GTNH.jar" } });
		await expect(replaceLocal(minecraft, custom, after)).rejects.toThrow("already this exact JAR");

		await restoreLocal(minecraft, "matter-manipulator", after);
		expect(readdirSync(path.join(minecraft, "mods")).sort()).toEqual(["matter-manipulator-0.1.75-GTNH.jar", "other.jar"]);
		expect(readFileSync(original)).toEqual(originalBytes);
		// The original is back: there is nothing left to restore.
		const restored = await inspectLocal(minecraft, "matter-manipulator");
		expect(restored.state.status === "ready" && restored.state.restore).toBeUndefined();
		await expect(restoreLocal(minecraft, "matter-manipulator", restored)).rejects.toThrow("not installed by this app");
	});

	it("restores the GTNH original after several custom builds", async () => {
		const { minecraft } = prismWithInstance();
		const folder = temporaryDirectory();
		const first = await readModJar(writeJar(path.join(folder, "mm-1.jar"), "matter-manipulator", "1"));
		const second = await readModJar(writeJar(path.join(folder, "mm-2.jar"), "matter-manipulator", "2"));
		await replaceLocal(minecraft, first, await inspectLocal(minecraft, "matter-manipulator"), new Date("2026-11-21T10:00:00Z"));
		await replaceLocal(minecraft, second, await inspectLocal(minecraft, "matter-manipulator"), new Date("2026-11-21T11:00:00Z"));
		expect(readdirSync(path.join(minecraft, "mods")).sort()).toEqual(["mm-2.jar", "other.jar"]);
		await restoreLocal(minecraft, "matter-manipulator", await inspectLocal(minecraft, "matter-manipulator"));
		expect(readdirSync(path.join(minecraft, "mods")).sort()).toEqual(["matter-manipulator-0.1.75-GTNH.jar", "other.jar"]);
	});

	it("refuses a target where several JARs provide the mod", async () => {
		const { minecraft } = prismWithInstance();
		writeJar(path.join(minecraft, "mods", "1.7.10", "mm-copy.jar"), "matter-manipulator", "0.1.74");
		const inspection = await inspectLocal(minecraft, "matter-manipulator");
		expect(inspection.state).toEqual({ status: "ambiguous", files: ["mods/1.7.10/mm-copy.jar", "mods/matter-manipulator-0.1.75-GTNH.jar"] });
		const custom = await readModJar(writeJar(path.join(temporaryDirectory(), "mm.jar"), "matter-manipulator", "2"));
		await expect(replaceLocal(minecraft, custom, inspection)).rejects.toThrow("Several JARs");
	});
});

describe("mods service on Prism instances", () => {
	function service(commandLines: string[] = []): { mods: ModsService; settings: ModsSettingsStore; progress: ModsProgress[] } {
		const settings = new ModsSettingsStore(path.join(temporaryDirectory(), "mods-settings.json"), () => "C:/default/instances");
		const progress: ModsProgress[] = [];
		const mods = new ModsService((event) => progress.push(event), settings, { javaCommandLines: async () => commandLines });
		return { mods, settings, progress };
	}

	it("remembers where a modid's JAR came from", async () => {
		const { mods, settings } = service();
		const folder = temporaryDirectory();
		const file = writeJar(path.join(folder, "mm.jar"), "matter-manipulator", "2");
		writeJar(path.join(folder, "mm-dev.jar"), "matter-manipulator", "2");
		const read = await mods.readFolder(folder);
		expect(read.modIds).toEqual(["matter-manipulator"]);
		expect(read.settings.sources).toEqual([{ modId: "matter-manipulator", folder, name: "matter-manipulator" }]);
		await expect(mods.readFolder(temporaryDirectory())).rejects.toThrow("No mod JAR");
		expect((await mods.listSource("matter-manipulator")).map((jar) => jar.path)).toEqual([file]);
		expect(settings.get()).toMatchObject({ prismDirectory: "C:/default/instances", prismDirectoryIsDefault: true });
		expect((await settings.setPrismDirectory("D:/prism")).prismDirectory).toBe("D:/prism");
		expect((await settings.setPrismDirectory(null)).prismDirectoryIsDefault).toBe(true);
		expect((await settings.forgetSource("matter-manipulator")).sources).toEqual([]);
	});

	it("inspects, replaces and restores on the chosen instances, refusing running ones", async () => {
		const { prism, instance, minecraft } = prismWithInstance();
		const jarPath = writeJar(path.join(temporaryDirectory(), "mm-custom.jar"), "matter-manipulator", "2");

		const idle = service();
		const inspected = await idle.mods.inspect({ modId: "matter-manipulator", prismDirectory: prism });
		expect(inspected.server).toBeUndefined();
		expect(inspected.instances).toMatchObject([{ id: "GTNH_2.9.0", state: { status: "ready" } }]);

		const running = service([`java -Djava.library.path=${instance}/natives`]);
		expect((await running.mods.inspect({ modId: "matter-manipulator", prismDirectory: prism })).instances[0]?.state).toEqual({ status: "running" });
		const refused = await running.mods.apply({ action: "replace", modId: "matter-manipulator", jarPath, prismDirectory: prism, instanceIds: ["GTNH_2.9.0"] });
		expect(refused).toMatchObject({ status: "failed", instances: [{ status: "failed", message: expect.stringContaining("running") }] });
		expect(existsSync(path.join(minecraft, "mods", "matter-manipulator-0.1.75-GTNH.jar"))).toBe(true);

		await expect(idle.mods.apply({ action: "replace", modId: "other", jarPath, prismDirectory: prism, instanceIds: ["GTNH_2.9.0"] })).rejects.toThrow(
			"provides matter-manipulator"
		);
		await expect(idle.mods.apply({ action: "replace", modId: "matter-manipulator", jarPath, prismDirectory: prism, instanceIds: [] })).rejects.toThrow("Choose the server");

		const replaced = await idle.mods.apply({ action: "replace", modId: "matter-manipulator", jarPath, prismDirectory: prism, instanceIds: ["GTNH_2.9.0"] });
		expect(replaced).toMatchObject({ status: "completed", instances: [{ status: "completed", label: "GTNH 2.9.0", installedFile: "mods/mm-custom.jar" }] });
		expect(idle.progress.at(-1)).toEqual({ stage: "completed", message: "All targets updated" });

		const restored = await idle.mods.apply({ action: "restore", modId: "matter-manipulator", prismDirectory: prism, instanceIds: ["GTNH_2.9.0"] });
		expect(restored).toMatchObject({ status: "completed", instances: [{ installedFile: "mods/matter-manipulator-0.1.75-GTNH.jar" }] });
	});
});
