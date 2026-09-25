/**
 * End-to-end checks against a real Linux host. Skipped unless GTNH_E2E_HOST is set.
 *
 *   GTNH_E2E_HOST, GTNH_E2E_USER (root), GTNH_E2E_KEY (~/.ssh/id_ed25519), GTNH_E2E_PORT (22)
 *   GTNH_E2E_FIXTURES   directory produced by scripts/make-e2e-fixtures.py
 *   GTNH_E2E_REAL_OLD   optional: absolute path of a real old installation on the host
 *   GTNH_E2E_REAL_BASE  optional: local original archive of that installation
 *   GTNH_E2E_REAL_NEW   optional: local archive of the new version (defaults to the base)
 *   GTNH_E2E_REAL_NEW_URL optional: HTTPS archive of the new version, downloaded by the server
 *
 * The host key must already be in ~/.ssh/known_hosts. Work happens under a fresh
 * /root/gtnh-e2e/run-<uuid> directory (or GTNH_E2E_ROOT) that is removed afterwards.
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vite-plus/test";
import type { SshConnectionInput } from "@shared/deployment.types";
import type { MergeDecision, MergeFileEntry } from "@shared/merge.types";
import { defaultDecisions } from "@shared/merge-model";
import { DeploymentService } from "../deployment/deployment.service";
import { MergeService } from "../merge/merge.service";
import { MigrationService } from "../migration/migration.service";
import { testConnection } from "../ssh/connection.service";
import { HostKeyStore, configureHostKeyStore } from "../ssh/host-key-store";
import { PID_DIRECTORY, RemoteClient, quoteShell } from "../ssh/remote-client";
import { CANCELLED_MESSAGE, withClient } from "../ssh/remote-operations";

const host = process.env.GTNH_E2E_HOST;
const fixtures = process.env.GTNH_E2E_FIXTURES;
const connection: SshConnectionInput = {
	host: host ?? "",
	port: Number(process.env.GTNH_E2E_PORT ?? 22),
	username: process.env.GTNH_E2E_USER ?? "root",
	privateKeyPath: process.env.GTNH_E2E_KEY ?? path.join(os.homedir(), ".ssh", "id_ed25519"),
};
const root = `${process.env.GTNH_E2E_ROOT ?? "/root/gtnh-e2e"}/run-${randomUUID()}`;
const MINUTE = 60_000;

async function remote(script: string): Promise<string> {
	return await withClient(connection, async (client) => await client.executeChecked(script));
}

async function remoteFile(remotePath: string): Promise<string> {
	return await remote(`cat ${quoteShell(remotePath)}`);
}

/** A sleep duration unique to this run, so its process can be found without matching the search itself. */
function uniqueSleep(): string {
	return `${600 + Math.floor(Math.random() * 300)}.${Math.floor(Math.random() * 1_000_000)}`;
}

/** Content, mode and timestamp digest of every file: any write to the tree changes it. */
async function treeFingerprint(directory: string): Promise<string> {
	return (
		await remote(`cd ${quoteShell(directory)} && find . -type f -printf '%p %m %T@\\n' | sort | sha256sum && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum`)
	).trim();
}

async function findSleep(duration: string): Promise<string> {
	return (await remote(`pgrep -f ${quoteShell(`[s]leep ${duration}`)} || true`)).trim();
}

describe.skipIf(!host)("real Linux host", () => {
	beforeAll(async () => {
		configureHostKeyStore(new HostKeyStore(path.join(os.tmpdir(), `gtnh-e2e-known-hosts-${randomUUID()}`)));
		await remote(`mkdir -p ${quoteShell(root)}`);
	}, MINUTE);

	afterAll(async () => {
		await remote(`rm -rf -- ${quoteShell(root)}`);
	}, 5 * MINUTE);

	it(
		"verifies the host from known_hosts and authenticates",
		async () => {
			const result = await testConnection(connection);
			expect(result.hostKey.status).toBe("known");
			expect(result.authenticated).toBe(true);
		},
		MINUTE
	);

	it(
		"kills a tracked command when the connection is torn down",
		async () => {
			const duration = uniqueSleep();
			const client = new RemoteClient(connection);
			await client.connect();
			const running = client.executeTracked(`sleep ${duration}`).catch((error: unknown) => error);
			await new Promise((resolve) => setTimeout(resolve, 1500));
			expect(await findSleep(duration)).not.toBe("");
			client.destroy();
			expect(await running).toBeInstanceOf(Error);

			await new Promise((resolve) => setTimeout(resolve, 3000));
			expect(await findSleep(duration)).toBe("");
			expect((await remote(`ls -A "${PID_DIRECTORY}" 2>/dev/null || true`)).trim()).toBe("");
		},
		MINUTE
	);

	it(
		"lists and stops an orphaned tracked process",
		async () => {
			const duration = uniqueSleep();
			const id = randomUUID();
			await remote([`mkdir -p "${PID_DIRECTORY}"`, `setsid sleep ${duration} </dev/null >/dev/null 2>&1 &`, `printf '%s\\n' "$!" > "${PID_DIRECTORY}/${id}.pid"`].join("\n"));
			const before = await testConnection(connection);
			const orphan = before.orphans.find((entry) => entry.id === id);
			expect(orphan?.command).toContain(`sleep ${duration}`);

			await withClient(connection, async (client) => await client.killOrphan(id, orphan!.pid));
			await new Promise((resolve) => setTimeout(resolve, 1000));
			expect(await findSleep(duration)).toBe("");
			expect((await testConnection(connection)).orphans.some((entry) => entry.id === id)).toBe(false);
		},
		MINUTE
	);

	describe.skipIf(!fixtures)("synthetic upgrade", () => {
		const oldServer = `${root}/synthetic/old`;
		const newServer = `${root}/synthetic/new`;
		let oldServerFingerprint = "";

		beforeAll(async () => {
			await withClient(connection, async (client) => {
				await client.executeChecked(`mkdir -p ${quoteShell(oldServer)}`);
				await client.upload(path.join(fixtures!, "old-server.zip"), `${root}/old-server.zip`, () => undefined);
				await client.executeChecked(`unzip -q ${quoteShell(`${root}/old-server.zip`)} -d ${quoteShell(oldServer)} && rm -f ${quoteShell(`${root}/old-server.zip`)}`);
			});
			oldServerFingerprint = await treeFingerprint(oldServer);
		}, MINUTE);

		afterAll(async () => {
			// Deploy, merge, migration and a cancelled upload all ran: the old server must be untouched.
			expect(await treeFingerprint(oldServer)).toBe(oldServerFingerprint);
		}, MINUTE);

		it(
			"deploys the new archive without leaving its temporary ZIP",
			async () => {
				const deployment = new DeploymentService(() => undefined);
				const preflight = await deployment.preflight({
					connection,
					source: { type: "local", path: path.join(fixtures!, "new.zip") },
					oldServerPath: oldServer,
					destinationPath: newServer,
				});
				expect(preflight.destinationExists).toBe(false);
				const result = await deployment.execute({ operationId: preflight.operationId });
				expect(result).toMatchObject({ status: "completed" });
				expect(await remoteFile(`${newServer}/config/c.cfg`)).toBe("c=1\n");
				expect((await remote(`ls -A ${quoteShell(`${root}/synthetic`)}`)).trim().split("\n").sort()).toEqual(["new", "old"]);
				expect((await remote(`ls ${quoteShell(`${newServer}/mods`)}`)).trim()).toBe("m2.jar");
			},
			2 * MINUTE
		);

		it(
			"proposes only user changes and applies the reviewed merge",
			async () => {
				const merge = new MergeService(() => undefined);
				const prepared = await merge.prepare({
					connection,
					baseSource: { type: "local", path: path.join(fixtures!, "base.zip") },
					oldServerPath: oldServer,
					newServerPath: newServer,
					extraExclusions: [],
				});
				onTestFailed(async () => {
					await merge.discardAll();
				});
				expect(prepared.baseMismatchWarning).toBeUndefined();
				expect(prepared.files).toEqual<MergeFileEntry[]>([
					{ path: "config/a.cfg", kind: "conflict" },
					{ path: "config/b.cfg", kind: "user-modified" },
					{ path: "config/binary.dat", kind: "conflict" },
					{ path: "config/regenerated.cfg", kind: "regenerated" },
					{ path: "config/removed-later.cfg", kind: "removed-by-new" },
					{ path: "config/user-added.cfg", kind: "mod-added" },
					{ path: "server.properties", kind: "conflict" },
					{ path: "serverutilities/server/ranks.txt", kind: "user-added" },
					{ path: "whitelist.json", kind: "user-modified" },
				]);

				const aDocument = await merge.loadFile({ operationId: prepared.operationId, path: "config/a.cfg" });
				if (aDocument.contentKind !== "text") throw new Error("a.cfg should be text");
				expect(aDocument.conflictCount).toBe(0);
				const binary = await merge.loadFile({ operationId: prepared.operationId, path: "config/binary.dat" });
				expect(binary.contentKind).toBe("binary");
				const properties = await merge.loadFile({ operationId: prepared.operationId, path: "server.properties" });
				expect(properties.contentKind === "text" && properties.conflictCount).toBeGreaterThan(0);

				const decisions = defaultDecisions(prepared.files);
				const set = (decision: MergeDecision): void => {
					decisions.set(decision.path, decision);
				};
				set({ path: "config/a.cfg", action: "write", lines: aDocument.merged.split("\n") });
				set({ path: "config/binary.dat", action: "keep-new" });
				// Files a mod recreates are not proposed: taking this one is an explicit choice.
				set({ path: "config/user-added.cfg", action: "take-old" });
				set({ path: "server.properties", action: "keep-new" });

				const result = await merge.apply({ operationId: prepared.operationId, baseMismatchAcknowledged: false, decisions: [...decisions.values()] });
				// Kept: the binary, server.properties, the file removed by the new version and the mod rewrite.
				expect(result).toMatchObject({ status: "completed", copied: 4, written: 1, kept: 4 });
				// The mod rewrite was not proposed, so the new server kept its own copy.
				expect(await remoteFile(`${newServer}/config/regenerated.cfg`)).toContain("# Enable the thing [default: true]");

				const aCfg = await remoteFile(`${newServer}/config/a.cfg`);
				expect(aCfg).toContain("alpha=10");
				expect(aCfg).toContain("epsilon=50");
				expect(await remoteFile(`${newServer}/config/b.cfg`)).toBe("b=2\n");
				expect(await remoteFile(`${newServer}/config/user-added.cfg`)).toBe("mine=1\n");
				expect(await remoteFile(`${newServer}/whitelist.json`)).toContain("Player");
				expect(await remoteFile(`${newServer}/server.properties`)).toContain("motd=v2");
				expect((await remote(`test -e ${quoteShell(`${newServer}/config/removed-later.cfg`)} && echo yes || echo no`)).trim()).toBe("no");
				// Old mods (including the user's custom jar) are never carried over; the new ones stay.
				expect((await remote(`ls ${quoteShell(`${newServer}/mods`)}`)).trim()).toBe("m2.jar");
				expect((await remote(`ls -A ${quoteShell(`${root}/synthetic`)}`)).trim().split("\n").sort()).toEqual(["new", "old"]);
			},
			3 * MINUTE
		);

		it(
			"migrates the world and its outside data, then aligns level-name",
			async () => {
				const migration = new MigrationService(() => undefined);
				const prepared = await migration.prepare({ connection, oldServerPath: oldServer, newServerPath: newServer, oldServerStoppedConfirmed: true });
				expect(prepared.worldName).toBe("MyWorld");
				expect(prepared.levelNameChange).toEqual({ from: "World", to: "MyWorld" });
				expect(prepared.items.map((item) => item.path)).toEqual(["MyWorld", "TCNodeTracker/MyWorld", "visualprospecting/server/MyWorld_0_overworld"]);
				expect(prepared.missingDataPaths).toEqual(["journeymap/data/sp/MyWorld"]);
				expect(prepared.ignoredWorlds).toEqual(["OldWorldBackup"]);
				expect(prepared.replacementConfirmationPath).toBeUndefined();

				const result = await migration.execute({ operationId: prepared.operationId });
				expect(result).toMatchObject({ status: "completed", levelNameRewritten: true });
				const region = `MyWorld/region/r.0.0.mca`;
				expect(await remote(`sha256sum ${quoteShell(`${newServer}/${region}`)} | cut -d' ' -f1`)).toBe(
					await remote(`sha256sum ${quoteShell(`${oldServer}/${region}`)} | cut -d' ' -f1`)
				);
				expect(await remoteFile(`${newServer}/server.properties`)).toContain("level-name=MyWorld");
				expect(await remoteFile(`${newServer}/server.properties`)).toContain("motd=v2");
				expect((await remote(`ls -A ${quoteShell(newServer)} | grep gtnh-migrate || true`)).trim()).toBe("");

				const again = await migration.prepare({ connection, oldServerPath: oldServer, newServerPath: newServer, oldServerStoppedConfirmed: true });
				expect(again.replacementConfirmationPath).toBe(`${again.resolvedNewServerPath}/MyWorld`);
				await expect(migration.execute({ operationId: again.operationId })).rejects.toThrow("exact");
			},
			3 * MINUTE
		);

		it(
			"cancels a deployment during upload and removes the temporary ZIP",
			async () => {
				const archive = process.env.GTNH_E2E_REAL_BASE;
				if (!archive) return;
				const deployment = new DeploymentService(() => undefined);
				const controller = new AbortController();
				setTimeout(() => controller.abort(), 1500);
				await expect(
					deployment.preflight(
						{
							connection,
							source: { type: "local", path: archive },
							oldServerPath: oldServer,
							destinationPath: `${root}/synthetic/cancelled`,
						},
						controller.signal
					)
				).rejects.toThrow(CANCELLED_MESSAGE);
				expect((await remote(`ls -A ${quoteShell(`${root}/synthetic`)}`)).trim().split("\n").sort()).toEqual(["new", "old"]);
			},
			2 * MINUTE
		);
	});

	describe.skipIf(!process.env.GTNH_E2E_REAL_OLD || !process.env.GTNH_E2E_REAL_BASE)("real GTNH installation", () => {
		const oldServer = process.env.GTNH_E2E_REAL_OLD!;
		const newServer = `${root}/real/new`;
		let oldServerFingerprint = "";

		beforeAll(async () => {
			oldServerFingerprint = await treeFingerprint(oldServer);
		}, 5 * MINUTE);

		afterAll(async () => {
			expect(await treeFingerprint(oldServer)).toBe(oldServerFingerprint);
		}, 5 * MINUTE);

		it(
			"deploys the real archive",
			async () => {
				await remote(`mkdir -p ${quoteShell(`${root}/real`)}`);
				const deployment = new DeploymentService(() => undefined);
				const preflight = await deployment.preflight({
					connection,
					// GTNH_E2E_REAL_NEW_URL exercises the server-side HTTPS download of a newer build.
					source: process.env.GTNH_E2E_REAL_NEW_URL
						? { type: "url", url: process.env.GTNH_E2E_REAL_NEW_URL }
						: { type: "local", path: process.env.GTNH_E2E_REAL_NEW ?? process.env.GTNH_E2E_REAL_BASE! },
					oldServerPath: oldServer,
					destinationPath: newServer,
				});
				console.log(`real preflight: ${preflight.compressedBytes} compressed, ${preflight.uncompressedBytes} extracted`);
				expect(await deployment.execute({ operationId: preflight.operationId })).toMatchObject({ status: "completed" });
				expect(Number(await remote(`find ${quoteShell(newServer)} -type f | wc -l`))).toBeGreaterThan(9000);
			},
			10 * MINUTE
		);

		it(
			"compares the real installation with its original archive",
			async () => {
				const merge = new MergeService(() => undefined);
				const started = Date.now();
				const prepared = await merge.prepare({
					connection,
					baseSource: { type: "local", path: process.env.GTNH_E2E_REAL_BASE! },
					oldServerPath: oldServer,
					newServerPath: newServer,
					extraExclusions: [],
				});
				const byKind = prepared.files.reduce<Record<string, number>>((counts, file) => ({ ...counts, [file.kind]: (counts[file.kind] ?? 0) + 1 }), {});
				console.log(
					`real merge in ${Math.round((Date.now() - started) / 1000)}s: compared=${prepared.comparedBaseFiles} changed=${prepared.userChangedBaseFiles} ${JSON.stringify(byKind)}`
				);
				console.log(prepared.files.map((file) => `${file.kind}\t${file.path}`).join("\n"));
				expect(prepared.baseMismatchWarning).toBeUndefined();
				expect(prepared.files.some((file) => file.path.startsWith("mods/") || file.path.startsWith("World/") || file.path.startsWith("backups/"))).toBe(false);
				expect(prepared.files.filter((file) => !file.path.includes("/") && /\.(zip|log)$/.test(file.path))).toEqual([]);
				await merge.discard(prepared.operationId);
			},
			10 * MINUTE
		);

		it(
			"plans the real world migration",
			async () => {
				const migration = new MigrationService(() => undefined);
				const prepared = await migration.prepare({ connection, oldServerPath: oldServer, newServerPath: newServer, oldServerStoppedConfirmed: true });
				console.log(JSON.stringify({ ...prepared, operationId: undefined }, null, 2));
				expect(prepared.worldName).toBe("World");
				expect(prepared.items[0]).toMatchObject({ path: "World", role: "world" });
			},
			10 * MINUTE
		);
	});
});
