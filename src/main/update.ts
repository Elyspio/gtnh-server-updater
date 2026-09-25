import { app } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateStatus } from "@shared/update.types";
import { log } from "./logger";

const { autoUpdater } = electronUpdater;
let pendingVersion = "";

/**
 * Checks GitHub releases at startup and downloads in the background. The update is applied on
 * the next quit, or earlier when the user restarts outside a remote operation.
 */
export function startAutoUpdate(emit: (status: UpdateStatus) => void): void {
	if (!app.isPackaged) return;
	// Its own console logger prints full HTTP errors (headers, cookies); events below are logged instead.
	autoUpdater.logger = null;
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.on("checking-for-update", () => emit({ state: "checking" }));
	autoUpdater.on("update-not-available", () => emit({ state: "none" }));
	autoUpdater.on("download-progress", (progress) =>
		emit({
			state: "downloading",
			version: pendingVersion,
			percent: Math.round(progress.percent),
		})
	);
	autoUpdater.on("update-available", (info) => {
		pendingVersion = info.version;
		log("info", `Update available: ${info.version}`);
	});
	autoUpdater.on("update-downloaded", (info) => {
		log("info", `Update downloaded: ${info.version}`);
		emit({ state: "ready", version: info.version });
	});
	autoUpdater.on("error", (error) => {
		const message = firstLine(error.message);
		log("error", `Update failed: ${message}`);
		emit({ state: "error", message });
	});
	// Failures are reported once by the "error" event above.
	void autoUpdater.checkForUpdates().catch(() => undefined);
}

export function installUpdateNow(): void {
	autoUpdater.quitAndInstall();
}

/** electron-updater appends HTTP headers (cookies included) to its messages: keep the summary only. */
function firstLine(message: string): string {
	return message.split("\n")[0]!.trim().slice(0, 300);
}
