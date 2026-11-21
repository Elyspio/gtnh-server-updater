import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
	old: new Map<string, Buffer>(),
	base: new Map<string, Buffer>(),
	new: new Map<string, Buffer>(),
	written: new Map<string, Buffer>(),
	executeChecked: vi.fn(),
}));

function tree(remotePath: string): Map<string, Buffer> {
	if (remotePath.includes("/old/")) return fixture.old;
	if (remotePath.includes("/new/")) return fixture.new;
	return fixture.base;
}

const client = {
	execute: async (script: string) => {
		const remotePath = /^test -f '([^']+)'$/.exec(script)?.[1];
		const exists = remotePath === undefined || tree(remotePath).has(remotePath.split("/").slice(3).join("/"));
		return { exitCode: exists ? 0 : 1, stdout: "", stderr: "" };
	},
	executeChecked: fixture.executeChecked,
	executeTrackedChecked: async (script: string) => {
		if (!script.includes("sha256sum")) return "";
		const entries = script.startsWith("cd '/servers/old'") ? fixture.old : script.startsWith("cd '/servers/new'") ? fixture.new : fixture.base;
		return [...entries].map(([path, content]) => `${createHash("sha256").update(content).digest("hex")}  ./${path}`).join("\n");
	},
	readFile: async (remotePath: string) => {
		const content = tree(remotePath).get(remotePath.split("/").slice(3).join("/"));
		if (!content) throw new Error(`Missing fixture file: ${remotePath}`);
		return { size: content.length, content };
	},
	writeFile: async (remotePath: string, content: Buffer) => fixture.written.set(remotePath, content),
};

vi.mock("../ssh/remote-operations", async (importOriginal) => ({
	...(await importOriginal<typeof import("../ssh/remote-operations")>()),
	withClient: async (_connection: unknown, action: (remote: unknown) => Promise<unknown>) => await action(client),
	assertRequiredTools: vi.fn(),
	resolveDirectory: async (_client: unknown, path: string) => path,
	ensureDirectory: async (_client: unknown, path: string) => path,
	fetchArchive: vi.fn().mockResolvedValue(10),
	inspectRemoteArchive: vi.fn().mockResolvedValue({ uncompressedBytes: 100 }),
	getAvailableBytes: vi.fn().mockResolvedValue(1_000_000),
}));
vi.mock("../migration/world-data", () => ({
	findWorldDirectories: vi.fn().mockResolvedValue([]),
	resolveWorldData: vi.fn().mockResolvedValue({ dataPaths: [] }),
}));

import { MergeService } from "./merge.service";

const request = {
	connection: { host: "fixture", port: 22, username: "updater", privateKeyPath: "/key" },
	oldServerPath: "/servers/old",
	newServerPath: "/servers/new",
	baseSource: { type: "url" as const, url: "https://example.com/base.zip" },
	extraExclusions: [],
};

beforeEach(() => {
	vi.clearAllMocks();
	for (const files of [fixture.old, fixture.base, fixture.new, fixture.written]) files.clear();
	fixture.executeChecked.mockImplementation(async (script: string) => (script.startsWith("find ") ? "/servers/new/config" : ""));
	// Keep the changed file below the archive mismatch threshold.
	for (let index = 0; index < 4; index++) {
		for (const files of [fixture.old, fixture.base, fixture.new]) files.set(`unchanged-${index}.txt`, Buffer.from("unchanged\n"));
	}
});

describe("reviewed text through prepare, load and apply", () => {
	it("writes an edited user-modified file using the new version's text format", async () => {
		const path = "config/GregTech/GregTech.cfg";
		fixture.old.set(path, Buffer.from("B:enabled=false\n"));
		for (const files of [fixture.base, fixture.new]) files.set(path, Buffer.from("\uFEFFB:enabled=true\r\n"));
		const service = new MergeService(() => undefined);
		const prepared = await service.prepare(request);
		expect(prepared.files).toEqual([{ path, kind: "user-modified" }]);
		const document = await service.loadFile({ operationId: prepared.operationId, path });
		expect(document).toMatchObject({ contentKind: "text", merged: "B:enabled=false", conflictCount: 0 });
		const result = await service.apply({
			operationId: prepared.operationId,
			baseMismatchAcknowledged: false,
			decisions: [{ path, action: "write", lines: ["B:enabled=reviewed"] }],
		});
		expect(result).toMatchObject({ status: "completed", written: 1 });
		expect(fixture.written.get(`/servers/new/${path}.gtnh-merge-${prepared.operationId}`)?.toString()).toBe("\uFEFFB:enabled=reviewed\r\n");
	});

	it.each([
		{ path: "serverutilities/ranks.txt", kind: "user-added" },
		{ path: "config/removed.cfg", kind: "removed-by-new" },
	])("writes reviewed $kind text using the old format when no new file exists", async ({ path, kind }) => {
		fixture.old.set(path, Buffer.from("\uFEFFold\r\ntext"));
		if (kind === "removed-by-new") fixture.base.set(path, Buffer.from("original"));
		const service = new MergeService(() => undefined);
		const prepared = await service.prepare(request);
		expect(prepared.files).toEqual([{ path, kind }]);
		expect(await service.loadFile({ operationId: prepared.operationId, path })).toMatchObject({ contentKind: "text" });
		const result = await service.apply({
			operationId: prepared.operationId,
			baseMismatchAcknowledged: false,
			decisions: [{ path, action: "write", lines: ["reviewed", "text"] }],
		});
		expect(result).toMatchObject({ status: "completed", written: 1 });
		expect(fixture.written.get(`/servers/new/${path}.gtnh-merge-${prepared.operationId}`)?.toString()).toBe("\uFEFFreviewed\r\ntext");
	});

	it("refuses text writes when a previously reviewed text file reloads as binary", async () => {
		const path = "config/user.cfg";
		fixture.old.set(path, Buffer.from("edited\n"));
		for (const files of [fixture.base, fixture.new]) files.set(path, Buffer.from("original\n"));
		const service = new MergeService(() => undefined);
		const prepared = await service.prepare(request);
		expect(await service.loadFile({ operationId: prepared.operationId, path })).toMatchObject({ contentKind: "text" });
		fixture.old.set(path, Buffer.from([0, 1, 2]));
		expect(await service.loadFile({ operationId: prepared.operationId, path })).toMatchObject({ contentKind: "binary" });
		await expect(
			service.apply({
				operationId: prepared.operationId,
				baseMismatchAcknowledged: false,
				decisions: [{ path, action: "write", lines: ["text"] }],
			})
		).rejects.toThrow("reviewed text file");
	});
});
