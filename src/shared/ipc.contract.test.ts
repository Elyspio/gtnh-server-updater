import { describe, expect, it } from "vite-plus/test";
import { INVOKE_CHANNELS } from "./ipc.channels";
import { ipcArguments } from "./ipc.contract";

const connection = { host: "gtnh.example.test", port: 22, username: "minecraft", privateKeyPath: "C:/keys/id_ed25519" };
const operationId = "7d0f6f0e-8f6b-4a3e-9e39-1a0c7f1f2b3c";

describe("IPC contract", () => {
	it("defines a schema for every channel exposed by the preload", () => {
		expect(Object.keys(ipcArguments).sort()).toEqual([...INVOKE_CHANNELS].sort());
	});

	it("accepts well-formed requests", () => {
		expect(
			ipcArguments["deployment:preflight"].safeParse([
				{
					connection,
					source: { type: "url", url: "https://example.test/server.zip" },
					oldServerPath: "/srv/old",
					destinationPath: "/srv/new",
				},
			]).success
		).toBe(true);
		expect(
			ipcArguments["merge:apply"].safeParse([
				{
					operationId,
					baseMismatchAcknowledged: false,
					decisions: [
						{ path: "config/a.cfg", action: "write", lines: ["a=1"] },
						{ path: "config/b.cfg", action: "take-old" },
					],
				},
			]).success
		).toBe(true);
	});

	it("trims the paths the user provides", () => {
		const listed = ipcArguments["remote:list"].safeParse([connection, "  /data/gtnh/daily-747 "]);
		expect(listed.success && listed.data[1]).toBe("/data/gtnh/daily-747");

		const created = ipcArguments["remote:mkdir"].safeParse([connection, "/data/gtnh ", "daily-747 "]);
		expect(created.success && created.data.slice(1)).toEqual(["/data/gtnh", "daily-747"]);

		const prepared = ipcArguments["merge:prepare"].safeParse([
			{
				connection: { ...connection, privateKeyPath: " C:/keys/id_ed25519 " },
				baseSource: { type: "url", url: " https://example.test/server.zip " },
				oldServerPath: "/srv/old ",
				newServerPath: " /srv/new",
				extraExclusions: [],
			},
		]);
		expect(prepared.success && prepared.data[0]).toMatchObject({
			connection: { privateKeyPath: "C:/keys/id_ed25519" },
			baseSource: { url: "https://example.test/server.zip" },
			oldServerPath: "/srv/old",
			newServerPath: "/srv/new",
		});

		const saved = ipcArguments["profiles:save"].safeParse([
			{
				name: "ely",
				host: "ely-minecraft",
				port: 22,
				username: "root",
				privateKeyPath: "C:/keys/id_ed25519 ",
				oldServerPath: "/data/gtnh/daily-731 ",
				newServerPath: "/data/gtnh/daily-747 ",
				serviceName: " gtnh ",
				rememberPassphrase: false,
			},
		]);
		expect(saved.success && saved.data[0]).toMatchObject({
			privateKeyPath: "C:/keys/id_ed25519",
			oldServerPath: "/data/gtnh/daily-731",
			newServerPath: "/data/gtnh/daily-747",
			serviceName: "gtnh",
		});

		expect(
			ipcArguments["mods:apply"].safeParse([
				{
					action: "replace",
					modId: "matter-manipulator",
					jarPath: "C:/builds/mm.jar",
					server: { connection, serviceName: "gtnh", restartConfirmed: true },
					prismDirectory: "C:/Prism/instances",
					instanceIds: ["GT_New_Horizons_2.9.0_Java_17-26"],
				},
			]).success
		).toBe(true);
	});

	it.each([
		["relative remote path", "remote:list", [connection, "srv/old"]],
		["missing connection field", "ssh:test", [{ ...connection, host: "" }]],
		["port out of range", "ssh:test", [{ ...connection, port: 70000 }]],
		["unknown decision action", "merge:apply", [{ operationId, baseMismatchAcknowledged: false, decisions: [{ path: "a", action: "delete" }] }]],
		["non uuid operation", "merge:discard", ["../../etc"]],
		["modid escaping the backup folder", "mods:list-source", ["../x"]],
		["shell in a service name", "mods:inspect", [{ modId: "mm", prismDirectory: "C:/p", server: { connection, serviceName: "gtnh;reboot" } }]],
		["option as a service name", "mods:inspect", [{ modId: "mm", prismDirectory: "C:/p", server: { connection, serviceName: "--all" } }]],
		["instance outside the Prism folder", "mods:apply", [{ action: "restore", modId: "mm", prismDirectory: "C:/p", instanceIds: ["../other"] }]],
		["folder name with a slash", "remote:mkdir", [connection, "/srv", "a/b"]],
		["parent folder name", "remote:mkdir", [connection, "/srv", ".."]],
		["forged fingerprint", "ssh:trust-host", [{ host: "h", port: 22, fingerprint: "SHA256:short" }]],
		["extra argument", "operation:cancel", [true]],
	] as const)("rejects %s", (_label, channel, args) => {
		expect(ipcArguments[channel].safeParse(args).success).toBe(false);
	});
});
