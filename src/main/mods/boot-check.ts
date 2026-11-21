import { quoteShell } from "../ssh/remote-client";

export const FML_LOG = "logs/fml-server-latest.log";
export const STARTED_MARKER = "Sent event FMLServerStartedEvent to mod FML";
export const EXCEPTION_MARKER = "Encountered an unexpected exception";
export const BOOT_TIMEOUT_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_MS = 5000;

/** State of the server folder and service, read once before the start and at each poll. */
export type BootObservation = {
	/** Inode of the FML log, empty when it does not exist. FML rolls the log at each start. */
	logInode: string;
	serviceState: string;
	started: boolean;
	exception: boolean;
	crashReports: string[];
};

export type BootTracker = { baseline: BootObservation; freshInode?: string; startedAt: number };

export type BootVerdict = { status: "pending" } | { status: "started" } | { status: "failed"; reason: string; crashReport?: string };

const ALIVE_STATES = new Set(["active", "activating", "reloading"]);

/**
 * Judges a start from successive observations. Only a log created after the start counts;
 * a second new log means the start script relaunched Java after a crash.
 */
export function assessBoot(tracker: BootTracker, observation: BootObservation, now: number): BootVerdict {
	const known = new Set(tracker.baseline.crashReports);
	const crashReport = observation.crashReports.find((name) => !known.has(name));
	if (crashReport) return { status: "failed", reason: `Crash report written: crash-reports/${crashReport}`, crashReport };

	if (observation.logInode && observation.logInode !== tracker.baseline.logInode) {
		if (tracker.freshInode === undefined) tracker.freshInode = observation.logInode;
		else if (tracker.freshInode !== observation.logInode) return { status: "failed", reason: "The start script relaunched the server after a crash" };
		if (observation.exception) return { status: "failed", reason: `The server log reports "${EXCEPTION_MARKER}"` };
		if (observation.started) return { status: "started" };
	}
	if (!ALIVE_STATES.has(observation.serviceState)) return { status: "failed", reason: `The service is ${observation.serviceState || "unknown"}` };
	if (now - tracker.startedAt > BOOT_TIMEOUT_MS) return { status: "failed", reason: `The server did not finish starting within ${BOOT_TIMEOUT_MS / 60_000} minutes` };
	return { status: "pending" };
}

/** One shell call per poll; fields are separated by a marker line. */
export function observationScript(serverPath: string, serviceName: string): string {
	const log = quoteShell(`${serverPath}/${FML_LOG}`);
	return [
		`printf '%s\\n' "$(stat -c %i -- ${log} 2>/dev/null)"`,
		`printf '%s\\n' "$(systemctl is-active -- ${quoteShell(serviceName)} 2>/dev/null)"`,
		`grep -q -F ${quoteShell(STARTED_MARKER)} -- ${log} 2>/dev/null && echo 1 || echo 0`,
		`grep -q -F ${quoteShell(EXCEPTION_MARKER)} -- ${log} 2>/dev/null && echo 1 || echo 0`,
		`ls -1 -- ${quoteShell(`${serverPath}/crash-reports`)} 2>/dev/null || true`,
	].join("\n");
}

export function parseObservation(output: string): BootObservation {
	const [logInode = "", serviceState = "", started = "0", exception = "0", ...crashReports] = output.split(/\r?\n/);
	return {
		logInode: logInode.trim(),
		serviceState: serviceState.trim(),
		started: started.trim() === "1",
		exception: exception.trim() === "1",
		crashReports: crashReports.map((name) => name.trim()).filter(Boolean),
	};
}

/** The lines worth reading after a failed start: the crash report head, or the log's errors. */
export function excerptScript(serverPath: string, crashReport?: string): string {
	if (crashReport) return `head -n 80 -- ${quoteShell(`${serverPath}/crash-reports/${crashReport}`)}`;
	const log = quoteShell(`${serverPath}/${FML_LOG}`);
	return `{ grep -E '/(ERROR|FATAL)\\]|Exception|^[[:space:]]+at ' -- ${log} || true; } | tail -n 60 | grep . || tail -n 40 -- ${log}`;
}
