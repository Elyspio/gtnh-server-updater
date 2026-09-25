import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_LOG_FILES = 5;

let logDirectory: string | undefined;

export function configureLogger(directory: string): void {
	mkdirSync(directory, { recursive: true });
	logDirectory = directory;
}

export function getLogDirectory(): string | undefined {
	return logDirectory;
}

/** Never pass passphrases, key material or file contents here. */
export function log(level: "info" | "error", message: string): void {
	if (!logDirectory) return;
	const file = path.join(logDirectory, "gtnh-updater.log");
	try {
		rotate(file);
		appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${redact(message)}\n`);
	} catch {
		// Logging must never break an operation.
	}
}

/** Query strings may carry download tokens. */
export function redact(message: string): string {
	return message.replace(/(https:\/\/[^\s'"?#]+)[?#][^\s'"]*/g, "$1?…");
}

function rotate(file: string): void {
	if (!existsSync(file) || statSync(file).size < MAX_LOG_BYTES) return;
	rmSync(`${file}.${MAX_LOG_FILES - 1}`, { force: true });
	for (let index = MAX_LOG_FILES - 2; index >= 1; index -= 1) {
		if (existsSync(`${file}.${index}`)) renameSync(`${file}.${index}`, `${file}.${index + 1}`);
	}
	renameSync(file, `${file}.1`);
}
