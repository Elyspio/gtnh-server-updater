/**
 * Runs the real main process and calls the contract bridge from the renderer:
 * preload allow-list, sender check, zod validation and services against a real host.
 *
 *   GTNH_E2E_HOST=ely-minecraft [GTNH_E2E_USER=root] [GTNH_E2E_KEY=~/.ssh/id_ed25519] electron scripts/ipc-smoke.cjs
 */
const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");

const host = process.env.GTNH_E2E_HOST;
if (!host) {
	console.error("GTNH_E2E_HOST is required");
	process.exit(2);
}
const connection = {
	host,
	port: Number(process.env.GTNH_E2E_PORT ?? 22),
	username: process.env.GTNH_E2E_USER ?? "root",
	privateKeyPath: process.env.GTNH_E2E_KEY ?? path.join(os.homedir(), ".ssh", "id_ed25519"),
};

require(path.join(__dirname, "../out/main/index.js"));

async function waitForWindow() {
	await app.whenReady();
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const window = BrowserWindow.getAllWindows()[0];
		if (window && !window.webContents.isLoading()) return window;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Main window did not load");
}

async function run() {
	const window = await waitForWindow();
	const results = await window.webContents.executeJavaScript(`(async () => {
    const connection = ${JSON.stringify(connection)};
    const outcome = async (call) => {
      try { return { ok: true, value: await call() }; }
      catch (error) { return { ok: false, error: String(error.message ?? error) }; }
    };
    return {
      test: await outcome(() => window.gtnh.invoke("ssh:test", connection)),
      list: await outcome(() => window.gtnh.invoke("remote:list", connection, "/root")),
      relativePath: await outcome(() => window.gtnh.invoke("remote:list", connection, "root")),
      unknownChannel: await outcome(() => window.gtnh.invoke("shell:exec", "id")),
      forgedFingerprint: await outcome(() => window.gtnh.invoke("ssh:trust-host", { host: connection.host, port: 22, fingerprint: "SHA256:forged" })),
      modsSettings: await outcome(() => window.gtnh.invoke("mods:settings")),
      injectedService: await outcome(() => window.gtnh.invoke("mods:inspect", { modId: "matter-manipulator", prismDirectory: "C:/none", server: { connection, serviceName: "gtnh;id" } })),
    };
  })()`);

	const checks = [
		["connection verified", results.test.ok && results.test.value.hostKey.status === "known" && results.test.value.authenticated],
		["remote listing", results.list.ok && Array.isArray(results.list.value)],
		["relative path refused by schema", !results.relativePath.ok && results.relativePath.error.includes("Invalid request")],
		["unknown channel refused by preload", !results.unknownChannel.ok && results.unknownChannel.error.includes("Unknown channel")],
		["forged fingerprint refused by schema", !results.forgedFingerprint.ok && results.forgedFingerprint.error.includes("Invalid request")],
		["mods settings with a Prism folder", results.modsSettings.ok && typeof results.modsSettings.value.prismDirectory === "string"],
		["shell in a service name refused by schema", !results.injectedService.ok && results.injectedService.error.includes("Invalid request")],
	];
	// Read only: locates the service and the mod on the server, and the Prism instances here.
	if (process.env.GTNH_SMOKE_SERVICE) {
		const inspected = await window.webContents.executeJavaScript(`window.gtnh.invoke("mods:settings").then((settings) => window.gtnh.invoke("mods:inspect", {
      modId: "matter-manipulator",
      prismDirectory: settings.prismDirectory,
      server: { connection: ${JSON.stringify(connection)}, serviceName: ${JSON.stringify(process.env.GTNH_SMOKE_SERVICE)} },
    }))`);
		console.log(JSON.stringify(inspected, null, 2));
		checks.push(["mods inspection of the real service", Boolean(inspected.server && inspected.server.state)]);
	}
	for (const [label, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
	if (checks.some(([, passed]) => !passed)) console.log(JSON.stringify(results, null, 2));
	app.exit(checks.every(([, passed]) => passed) ? 0 : 1);
}

run().catch((error) => {
	console.error(error);
	app.exit(1);
});
