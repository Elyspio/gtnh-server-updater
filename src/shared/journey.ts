import type { DeploymentResult } from "./deployment.types";
import type { MergeApplyResult } from "./merge.types";
import type { MigrationResult } from "./migration.types";

export const JOURNEY_STEPS = ["server", "stop", "deploy", "merge", "migrate", "report"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

export const STEP_LABELS: Record<JourneyStep, string> = {
	server: "Server",
	stop: "Stop old server",
	deploy: "Deploy",
	merge: "Carry over changes",
	migrate: "Migrate world",
	report: "Report",
};

export type DeploymentRecord = { archive: string; result: DeploymentResult; durationMs: number };
export type MergeRecord =
	| { status: "skipped" }
	| { status: "done"; result: MergeApplyResult; copiedPaths: string[]; mergedPaths: string[]; keptPaths: string[]; durationMs: number };
export type MigrationRecord = { status: "skipped" } | { status: "done"; worldName: string; result: MigrationResult; durationMs: number };

export type JourneyState = {
	serverReady: boolean;
	stopConfirmed: boolean;
	deployment?: DeploymentRecord;
	merge?: MergeRecord;
	migration?: MigrationRecord;
};

export const INITIAL_JOURNEY: JourneyState = { serverReady: false, stopConfirmed: false };

/** A step opens once the previous one is complete; merge and migration may be skipped explicitly. */
export function isStepComplete(state: JourneyState, step: JourneyStep): boolean {
	switch (step) {
		case "server":
			return state.serverReady;
		case "stop":
			return state.stopConfirmed;
		case "deploy":
			return state.deployment?.result.status === "completed";
		case "merge":
			return state.merge?.status === "skipped" || state.merge?.result.status === "completed";
		case "migrate":
			return state.migration?.status === "skipped" || state.migration?.result.status === "completed";
		case "report":
			return false;
	}
}

export function isStepUnlocked(state: JourneyState, step: JourneyStep): boolean {
	const index = JOURNEY_STEPS.indexOf(step);
	return JOURNEY_STEPS.slice(0, index).every((previous) => isStepComplete(state, previous));
}

/** True once anything beyond the server step happened: changing the server then restarts the journey. */
export function hasProgress(state: JourneyState): boolean {
	return state.stopConfirmed || Boolean(state.deployment || state.merge || state.migration);
}

export type JourneyReport = {
	generatedAt: Date;
	host: string;
	username: string;
	oldServerPath: string;
	newServerPath: string;
	state: JourneyState;
};

export function buildReportMarkdown(report: JourneyReport): string {
	const { state } = report;
	const lines = [
		"# GTNH server update report",
		"",
		`- Generated: ${report.generatedAt.toISOString()}`,
		`- Server: ${report.username}@${report.host}`,
		`- Old server (read only): \`${report.oldServerPath}\``,
		`- New server: \`${report.newServerPath}\``,
		`- Old server stopped by the user: ${state.stopConfirmed ? "confirmed" : "not confirmed"}`,
		"",
		"## Deployment",
		"",
	];

	if (!state.deployment) {
		lines.push("Not run.");
	} else {
		const { result } = state.deployment;
		lines.push(
			`- Archive: \`${state.deployment.archive}\``,
			`- Status: ${result.status}${result.error ? ` (${result.error})` : ""}`,
			`- Destination: \`${result.destinationPath}\``,
			`- Duration: ${formatDuration(state.deployment.durationMs)}`
		);
		if (result.partialDestinationPreserved) lines.push("- Partial files were kept in the destination.");
	}

	lines.push("", "## Carried-over changes", "");
	if (!state.merge) {
		lines.push("Not run.");
	} else if (state.merge.status === "skipped") {
		lines.push("Skipped by the user: the new server keeps the files of the new version.");
	} else {
		const { result } = state.merge;
		lines.push(
			`- Status: ${result.status}${result.error ? ` (${result.error}${result.failedPath ? `, at ${result.failedPath}` : ""})` : ""}`,
			`- Copied from the old server: ${result.copied}`,
			`- Written from a reviewed merge: ${result.written}`,
			`- Left as in the new version: ${result.kept}`,
			`- Duration: ${formatDuration(state.merge.durationMs)}`
		);
		appendPaths(lines, "Copied files", state.merge.copiedPaths);
		appendPaths(lines, "Merged files", state.merge.mergedPaths);
		appendPaths(lines, "Proposed but kept from the new version", state.merge.keptPaths);
	}

	lines.push("", "## World migration", "");
	if (!state.migration) {
		lines.push("Not run.");
	} else if (state.migration.status === "skipped") {
		lines.push("Skipped by the user: no world data was copied.");
	} else {
		const { result } = state.migration;
		lines.push(
			`- World: \`${state.migration.worldName}\``,
			`- Status: ${result.status}${result.error ? ` (${result.error})` : ""}`,
			`- level-name rewritten: ${result.levelNameRewritten ? "yes" : "no"}`,
			`- Duration: ${formatDuration(state.migration.durationMs)}`
		);
		appendPaths(lines, "Copied paths", result.copiedPaths);
		if (result.partialPath) lines.push("", `Partial files kept at \`${result.partialPath}\`.`);
	}
	return `${lines.join("\n")}\n`;
}

function appendPaths(lines: string[], title: string, paths: string[]): void {
	if (paths.length === 0) return;
	lines.push("", `### ${title}`, "", ...paths.map((path) => `- \`${path}\``));
}

export function formatDuration(milliseconds: number): string {
	const seconds = Math.round(milliseconds / 1000);
	if (seconds < 60) return `${seconds} s`;
	return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
