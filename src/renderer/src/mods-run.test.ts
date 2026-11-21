import { describe, expect, it } from "vite-plus/test";
import type { ModsProgress } from "@shared/mods.types";
import { appendEntry, type ModsRun, runTrace } from "./mods-run";

const play = (action: ModsRun["action"], events: ModsProgress[]): ModsRun => events.reduce<ModsRun>((run, event, index) => appendEntry(run, event, index), { action, entries: [] });

const states = (run: ModsRun | undefined): string[] => runTrace(run).map((step) => step.state);

describe("mods run trace", () => {
	it("shows every stage as to do before a run", () => {
		expect(states(undefined)).toEqual(["todo", "todo", "todo", "todo", "todo", "todo"]);
	});

	it("follows a server install as it goes", () => {
		const run = play("replace", [
			{ stage: "checking", message: "Locating" },
			{ stage: "uploading", message: "Uploading" },
			{ stage: "stopping", message: "Stopping" },
			{ stage: "replacing", message: "Installing" },
			{ stage: "starting", message: "Starting" },
			{ stage: "verifying", message: "Waiting (5 s)" },
			{ stage: "verifying", message: "Waiting (10 s)" },
		]);
		expect(states(run)).toEqual(["done", "done", "done", "done", "live", "todo"]);
		expect(run.entries).toHaveLength(6);
		expect(runTrace(run)[4]?.detail).toBe("Waiting (10 s)");
	});

	it("keeps the fault on the start when the server is stopped after a failed boot", () => {
		const run = play("replace", [
			{ stage: "checking", message: "Locating" },
			{ stage: "uploading", message: "Uploading" },
			{ stage: "stopping", message: "Stopping" },
			{ stage: "replacing", message: "Installing" },
			{ stage: "starting", message: "Starting" },
			{ stage: "stopping", message: "Crash report; stopping" },
			{ stage: "failed", message: "Some targets were not updated" },
		]);
		expect(states(run)).toEqual(["done", "done", "done", "done", "fault", "skipped"]);
	});

	it("marks the server stages skipped for a Prism-only restore", () => {
		const run = play("restore", [
			{ stage: "clients", message: "Updating 1 Prism instance(s)" },
			{ stage: "completed", message: "All targets updated" },
		]);
		expect(states(run)).toEqual(["skipped", "skipped", "skipped", "skipped", "skipped", "done"]);
	});
});
