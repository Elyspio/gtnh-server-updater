/**
 * Mods mode against a real Linux host. Skipped unless GTNH_E2E_HOST is set (same variables
 * as remote.e2e.test.ts). A throwaway runtime unit `gtnh-mods-e2e-<id>.service` in
 * /run/systemd/system runs a fake server in a fresh directory under GTNH_E2E_ROOT; both are
 * removed afterwards. No other service or file of the host is touched.
 *
 * GTNH_E2E_REAL_SERVICE optional: a real GTNH unit, only inspected (read only).
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { SshConnectionInput } from "@shared/deployment.types";
import type { ModsProgress } from "@shared/mods.types";
import { ModsService } from "../mods/mods.service";
import { ModsSettingsStore } from "../mods/mods-settings-store";
import { makeZip, modInfoJson } from "../mods/zip-fixture";
import { HostKeyStore, configureHostKeyStore } from "../ssh/host-key-store";
import { quoteShell } from "../ssh/remote-client";
import { withClient } from "../ssh/remote-operations";

const host = process.env.GTNH_E2E_HOST;
const connection: SshConnectionInput = {
	host: host ?? "",
	port: Number(process.env.GTNH_E2E_PORT ?? 22),
	username: process.env.GTNH_E2E_USER ?? "root",
	privateKeyPath: process.env.GTNH_E2E_KEY ?? path.join(os.homedir(), ".ssh", "id_ed25519"),
};
const id = randomUUID().slice(0, 8);
const serviceName = `gtnh-mods-e2e-${id}`;
const unitFile = `/run/systemd/system/${serviceName}.service`;
const serverPath = `${process.env.GTNH_E2E_ROOT ?? "/root/gtnh-e2e"}/mods-${id}`;
const MINUTE = 60_000;

/**
 * Mimics FML: the previous log is rolled, a new one is written; a JAR whose version is
 * "crash" writes a crash report and makes Java exit, like a mod failing at load.
 */
const START_SCRIPT = `#!/bin/sh
cd "$(dirname "$0")"
mkdir -p logs crash-reports
[ ! -f logs/fml-server-latest.log ] || mv logs/fml-server-latest.log logs/fml-server-1.log
echo "[00:00:00] [main/INFO] [FML/]: Forge Mod Loader version 7.99.40.1614 for Minecraft 1.7.10 loading" > logs/fml-server-latest.log
for f in mods/*.jar; do
  if unzip -p "$f" mcmod.info | grep -q '"version":"crash"'; then
    echo "[00:00:01] [Server thread/ERROR] [FML/]: Caught exception from matter-manipulator" >> logs/fml-server-latest.log
    printf -- '---- Minecraft Crash Report ----\\nDescription: Exception in server tick loop\\n' > "crash-reports/crash-$(date +%s%N)-server.txt"
    exit 1
  fi
done
sleep 2
echo "[00:00:02] [Server thread/TRACE] [FML/FML]: Sent event FMLServerStartedEvent to mod FML" >> logs/fml-server-latest.log
exec sleep 3600
`;

async function remote(script: string): Promise<string> {
	return await withClient(connection, async (client) => await client.executeChecked(script));
}

function localJar(name: string, version: string): string {
	const file = path.join(mkdtempSync(path.join(os.tmpdir(), "gtnh-mods-e2e-")), name);
	writeFileSync(file, makeZip({ "mcmod.info": modInfoJson("matter-manipulator", version), "content.txt": version }));
	return file;
}

describe.skipIf(!host)("Mods mode on a real Linux host", () => {
	const progress: ModsProgress[] = [];
	const settings = new ModsSettingsStore(path.join(mkdtempSync(path.join(os.tmpdir(), "gtnh-mods-settings-")), "settings.json"), () => os.tmpdir());
	const mods = new ModsService((event) => progress.push(event), settings, { javaCommandLines: async () => [] });
	const server = { connection, serviceName };
	const emptyPrism = mkdtempSync(path.join(os.tmpdir(), "gtnh-mods-prism-"));

	beforeAll(async () => {
		configureHostKeyStore(new HostKeyStore(path.join(os.tmpdir(), `gtnh-e2e-known-hosts-${randomUUID()}`)));
		const original = localJar("matter-manipulator-0.1.75-GTNH.jar", "0.1.75");
		await withClient(connection, async (client) => {
			await client.executeChecked(`mkdir -p ${quoteShell(`${serverPath}/mods`)}`);
			await client.upload(original, `${serverPath}/mods/matter-manipulator-0.1.75-GTNH.jar`, () => undefined);
			await client.writeFile(`${serverPath}/start.sh`, Buffer.from(START_SCRIPT, "utf8"));
			await client.writeFile(
				unitFile,
				Buffer.from(
					`[Unit]\nDescription=GTNH updater Mods e2e\n\n[Service]\nType=simple\nWorkingDirectory=${serverPath}\nExecStart=/bin/sh ${serverPath}/start.sh\n`,
					"utf8"
				)
			);
			// The fake server's files belong to another account, like the minecraft user of a real install.
			await client.executeChecked(`chown -R nobody: ${quoteShell(`${serverPath}/mods`)} && systemctl daemon-reload && systemctl start ${quoteShell(serviceName)}`);
		});
	}, MINUTE);

	afterAll(async () => {
		await remote(
			`systemctl stop ${quoteShell(serviceName)} 2>/dev/null; rm -f -- ${quoteShell(unitFile)}; systemctl daemon-reload; systemctl reset-failed ${quoteShell(serviceName)} 2>/dev/null; rm -rf -- ${quoteShell(serverPath)}`
		);
	}, 3 * MINUTE);

	it(
		"finds the server folder from the unit and the GTNH JAR from its mcmod.info",
		async () => {
			const inspected = await mods.inspect({ modId: "matter-manipulator", prismDirectory: emptyPrism, server });
			expect(inspected.server).toEqual({
				state: {
					serviceName,
					serverPath,
					serviceState: "active",
					state: { status: "ready", current: expect.objectContaining({ relativePath: "mods/matter-manipulator-0.1.75-GTNH.jar", version: "0.1.75" }) },
				},
			});
			const missing = await mods.inspect({ modId: "matter-manipulator", prismDirectory: emptyPrism, server: { connection, serviceName: `${serviceName}-missing` } });
			expect(missing.server).toEqual({ error: expect.stringContaining("not installed") });
		},
		MINUTE
	);

	it(
		"stops, replaces, starts and waits for FML, keeping the original's owner",
		async () => {
			const result = await mods.apply({
				action: "replace",
				modId: "matter-manipulator",
				jarPath: localJar("matter-manipulator-0.2.2-custom.jar", "0.2.2"),
				server: { ...server, restartConfirmed: true },
				prismDirectory: emptyPrism,
				instanceIds: [],
			});
			expect(result.server?.message).toBeUndefined();
			expect(result).toMatchObject({ status: "completed", server: { status: "completed", installedFile: "mods/matter-manipulator-0.2.2-custom.jar" } });
			expect(progress.map((event) => event.stage)).toEqual(expect.arrayContaining(["uploading", "stopping", "replacing", "starting", "verifying", "completed"]));
			const state = await remote(
				`cd ${quoteShell(serverPath)} && ls mods && stat -c %U mods/matter-manipulator-0.2.2-custom.jar && ls mods-backup/matter-manipulator/*/ && systemctl is-active ${quoteShell(serviceName)}`
			);
			expect(state.trim().split("\n")).toEqual(["matter-manipulator-0.2.2-custom.jar", "nobody", "installed.json", "matter-manipulator-0.1.75-GTNH.jar", "active"]);
			expect(await mods.activeCustomMods(connection, serverPath)).toMatchObject([{ modId: "matter-manipulator", installedFile: "mods/matter-manipulator-0.2.2-custom.jar" }]);
		},
		3 * MINUTE
	);

	it(
		"stops the service and reports the crash when the new JAR does not start",
		async () => {
			const result = await mods.apply({
				action: "replace",
				modId: "matter-manipulator",
				jarPath: localJar("matter-manipulator-broken.jar", "crash"),
				server: { ...server, restartConfirmed: true },
				prismDirectory: emptyPrism,
				instanceIds: [],
			});
			expect(result).toMatchObject({ status: "failed", server: { status: "failed", message: expect.stringContaining("Crash report written") } });
			expect(result.server?.logExcerpt).toContain("Minecraft Crash Report");
			expect((await remote(`systemctl is-active ${quoteShell(serviceName)} || true`)).trim()).not.toBe("active");
		},
		3 * MINUTE
	);

	it(
		"restores the GTNH original and starts the server again",
		async () => {
			const result = await mods.apply({
				action: "restore",
				modId: "matter-manipulator",
				server: { ...server, restartConfirmed: true },
				prismDirectory: emptyPrism,
				instanceIds: [],
			});
			expect(result).toMatchObject({ status: "completed", server: { status: "completed", installedFile: "mods/matter-manipulator-0.1.75-GTNH.jar" } });
			const state = await remote(
				`cd ${quoteShell(serverPath)} && ls mods && stat -c %U mods/matter-manipulator-0.1.75-GTNH.jar && systemctl is-active ${quoteShell(serviceName)}`
			);
			expect(state.trim().split("\n")).toEqual(["matter-manipulator-0.1.75-GTNH.jar", "nobody", "active"]);
			expect(await mods.activeCustomMods(connection, serverPath)).toEqual([]);
		},
		3 * MINUTE
	);

	it.skipIf(!process.env.GTNH_E2E_REAL_SERVICE)(
		"inspects a real GTNH service without changing it",
		async () => {
			const inspected = await mods.inspect({
				modId: "matter-manipulator",
				prismDirectory: emptyPrism,
				server: { connection, serviceName: process.env.GTNH_E2E_REAL_SERVICE ?? "" },
			});
			expect(inspected.server).toMatchObject({ state: { state: { status: "ready" } } });
		},
		MINUTE
	);
});
