import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Command lines of running Java processes; Prism passes the instance folder to the game. */
export async function listJavaCommandLines(platform: NodeJS.Platform = process.platform): Promise<string[]> {
	if (platform === "win32") {
		const { stdout } = await run(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='java.exe' OR Name='javaw.exe'\" | ForEach-Object { $_.CommandLine }"],
			{ windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }
		);
		return stdout.split(/\r?\n/).filter(Boolean);
	}
	if (platform === "linux") {
		const lines: string[] = [];
		for (const pid of (await readdir("/proc")).filter((name) => /^\d+$/.test(name))) {
			try {
				const commandLine = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").join(" ");
				if (/java/i.test(commandLine)) lines.push(commandLine);
			} catch {
				// The process ended meanwhile.
			}
		}
		return lines;
	}
	const { stdout } = await run("ps", ["-axo", "command"], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
	return stdout.split("\n").filter((line) => /java/i.test(line));
}

/** True when a Java command line mentions the instance folder, whatever the slash style. */
export function isInstanceRunning(instanceDirectory: string, commandLines: string[], platform: NodeJS.Platform = process.platform): boolean {
	const normalize = (value: string): string => {
		const slashes = value.replace(/\\/g, "/");
		return platform === "win32" ? slashes.toLowerCase() : slashes;
	};
	const needle = `${normalize(instanceDirectory).replace(/\/+$/, "")}/`;
	return commandLines.some((line) => normalize(line).includes(needle));
}
