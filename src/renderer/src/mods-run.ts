import type { ModsApplyRequest, ModsProgress, ModsStage } from "@shared/mods.types";

export type RunEntry = ModsProgress & { at: number };

/** One install or restore, as reported by `mods:progress` while it runs. */
export type ModsRun = { action: ModsApplyRequest["action"]; entries: RunEntry[] };

export type TraceState = "done" | "live" | "fault" | "todo" | "skipped";
export type TraceStep = { label: string; state: TraceState; detail?: string };

const RUN_STEPS: Array<{ label: string; stages: ModsStage[] }> = [
	{ label: "Check", stages: ["checking"] },
	{ label: "Upload", stages: ["uploading"] },
	{ label: "Stop the service", stages: ["stopping"] },
	{ label: "Swap the JAR", stages: ["replacing"] },
	{ label: "Start and check", stages: ["starting", "verifying"] },
	{ label: "Prism instances", stages: ["clients"] },
];

const stepOf = (stage: ModsStage): number => RUN_STEPS.findIndex((step) => step.stages.includes(stage));

/** Adds a progress event; repeated "waiting for the server" polls replace each other instead of piling up. */
export function appendEntry(run: ModsRun, progress: ModsProgress, at: number): ModsRun {
	const last = run.entries.at(-1);
	const entry = { ...progress, at };
	if (last?.stage === "verifying" && progress.stage === "verifying") return { ...run, entries: [...run.entries.slice(0, -1), entry] };
	return { ...run, entries: [...run.entries, entry] };
}

/**
 * The run as a sequence. Stages the backend never reported before the furthest one were skipped
 * (no upload on a restore, no server stages without a server); the stop after a failed start does
 * not move the trace back.
 */
export function runTrace(run: ModsRun | undefined): TraceStep[] {
	const entries = run?.entries ?? [];
	const reached = Math.max(-1, ...entries.map((entry) => stepOf(entry.stage)));
	const terminal = entries.at(-1)?.stage;
	const finished = terminal === "completed" || terminal === "failed";
	return RUN_STEPS.map((step, index) => {
		const detail = entries.findLast((entry) => step.stages.includes(entry.stage))?.message;
		if (!run) return { label: step.label, state: "todo" };
		if (index < reached) return { label: step.label, state: detail ? "done" : "skipped", detail: detail ?? "skipped" };
		if (index === reached) {
			const state = terminal === "completed" ? "done" : terminal === "failed" ? "fault" : "live";
			return { label: step.label, state, detail };
		}
		return finished ? { label: step.label, state: "skipped", detail: "skipped" } : { label: step.label, state: "todo" };
	});
}

export function formatClock(at: number): string {
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
