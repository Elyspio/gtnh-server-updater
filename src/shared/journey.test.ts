import { describe, expect, it } from "vite-plus/test";
import { INITIAL_JOURNEY, type JourneyState, buildReportMarkdown, hasProgress, isStepComplete, isStepUnlocked } from "./journey";

const deployed: JourneyState = {
	serverReady: true,
	stopConfirmed: true,
	deployment: {
		archive: "GTNH-daily-731.zip",
		result: { operationId: "a", status: "completed", destinationPath: "/srv/new", partialDestinationPreserved: false },
		durationMs: 12_000,
	},
};

describe("journey", () => {
	it("opens each step only after the previous one", () => {
		expect(isStepUnlocked(INITIAL_JOURNEY, "server")).toBe(true);
		expect(isStepUnlocked(INITIAL_JOURNEY, "stop")).toBe(false);
		expect(isStepUnlocked({ ...INITIAL_JOURNEY, serverReady: true }, "stop")).toBe(true);
		expect(isStepUnlocked({ ...INITIAL_JOURNEY, serverReady: true }, "deploy")).toBe(false);
		expect(isStepUnlocked(deployed, "merge")).toBe(true);
		expect(isStepUnlocked(deployed, "migrate")).toBe(false);
	});

	it("requires a successful deployment but allows skipping merge and migration", () => {
		const failed: JourneyState = { ...deployed, deployment: { ...deployed.deployment!, result: { ...deployed.deployment!.result, status: "failed" } } };
		expect(isStepComplete(failed, "deploy")).toBe(false);
		const skipped: JourneyState = { ...deployed, merge: { status: "skipped" }, migration: { status: "skipped" } };
		expect(isStepUnlocked(skipped, "report")).toBe(true);
	});

	it("detects progress beyond the server step", () => {
		expect(hasProgress({ ...INITIAL_JOURNEY, serverReady: true })).toBe(false);
		expect(hasProgress({ ...INITIAL_JOURNEY, serverReady: true, stopConfirmed: true })).toBe(true);
	});

	it("writes a Markdown report with skipped steps and file lists", () => {
		const markdown = buildReportMarkdown({
			generatedAt: new Date("2026-09-19T12:00:00Z"),
			host: "10.0.0.59",
			username: "root",
			oldServerPath: "/srv/old",
			newServerPath: "/srv/new",
			state: {
				...deployed,
				merge: {
					status: "done",
					result: { operationId: "b", status: "completed", copied: 1, written: 1, kept: 1 },
					copiedPaths: ["config/b.cfg"],
					mergedPaths: ["config/a.cfg"],
					keptPaths: ["server.properties"],
					durationMs: 75_000,
				},
				migration: { status: "skipped" },
			},
		});
		expect(markdown).toContain("- Server: root@10.0.0.59");
		expect(markdown).toContain("- Duration: 12 s");
		expect(markdown).toContain("- Duration: 1 min 15 s");
		expect(markdown).toContain("### Merged files\n\n- `config/a.cfg`");
		expect(markdown).toContain("Skipped by the user: no world data was copied.");
	});
});
