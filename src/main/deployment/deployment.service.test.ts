import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { DeploymentProgress } from "@shared/deployment.types";

const remote = vi.hoisted(() => ({
	execute: vi.fn(),
	executeChecked: vi.fn(),
	executeTracked: vi.fn(),
	executeTrackedChecked: vi.fn(),
}));
const cleanup = vi.hoisted(() => vi.fn());

vi.mock("../ssh/remote-operations", async (importOriginal) => ({
	...(await importOriginal<typeof import("../ssh/remote-operations")>()),
	withClient: async (_connection: unknown, action: (client: unknown) => Promise<unknown>) => await action(remote),
	assertRequiredTools: vi.fn(),
	fetchArchive: vi.fn().mockResolvedValue(10),
	getAvailableBytes: vi.fn().mockResolvedValue(1_000_000),
	inspectRemoteArchive: vi.fn().mockResolvedValue({ compressedBytes: 10, uncompressedBytes: 100 }),
	removeRemoteTemporaries: cleanup,
}));

import { DeploymentService } from "./deployment.service";

const request = {
	connection: { host: "server", port: 22, username: "updater", privateKeyPath: "/key" },
	source: { type: "url" as const, url: "https://example.com/new.zip" },
	oldServerPath: "/servers/old",
	destinationPath: "/servers/new",
};

beforeEach(() => {
	vi.clearAllMocks();
	remote.execute.mockResolvedValue({ stdout: "", stderr: "", exitCode: 1 });
	remote.executeChecked.mockImplementation(async (script: string) => {
		if (script.includes("pwd -P")) return script.includes("/servers/old") ? "/servers/old\n" : "/servers\n";
		return "";
	});
	remote.executeTracked.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
	remote.executeTrackedChecked.mockResolvedValue("");
});

describe("deployment access", () => {
	it("completes only after matching access to the old server", async () => {
		const stages: DeploymentProgress["stage"][] = [];
		const service = new DeploymentService((progress) => stages.push(progress.stage));
		const preflight = await service.preflight(request);
		const result = await service.execute({ operationId: preflight.operationId });
		expect(result.status).toBe("completed");
		expect(stages.slice(-4)).toEqual(["extracting", "aligning-access", "cleaning-up", "completed"]);
		expect(remote.executeTrackedChecked).toHaveBeenCalledOnce();
	});

	it("reports access failures and preserves the extracted destination", async () => {
		const stages: DeploymentProgress["stage"][] = [];
		const service = new DeploymentService((progress) => stages.push(progress.stage));
		const preflight = await service.preflight(request);
		remote.executeTrackedChecked.mockRejectedValueOnce(new Error("chown: Operation not permitted"));
		const result = await service.execute({ operationId: preflight.operationId });
		expect(result).toMatchObject({
			status: "failed",
			partialDestinationPreserved: true,
			error: "Unable to match the old server's ownership and permissions: chown: Operation not permitted",
		});
		expect(stages.slice(-2)).toEqual(["aligning-access", "failed"]);
		expect(cleanup).toHaveBeenCalledWith(request.connection, [preflight.temporaryArchivePath]);
	});
});
