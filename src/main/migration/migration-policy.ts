/** GTNH default of serverutilities `additional_backup_files`, used when the old server has none. */
export const DEFAULT_WORLD_DATA_PATTERNS = ["journeymap/data/sp/$WORLDNAME/**", "TCNodeTracker/$WORLDNAME/**", "visualprospecting/server/$WORLDNAME_*/**"] as const;

const LEVEL_NAME_LINE = /^(\s*level-name\s*[=:]\s*)(.*)$/;

export function parseLevelName(serverProperties: string): string {
	const line = serverProperties
		.split(/\r?\n/)
		.map((value) => LEVEL_NAME_LINE.exec(value))
		.find(Boolean);
	const levelName = line?.[2]?.trim();
	if (!levelName) throw new Error("level-name is missing from the old server.properties");
	assertWorldName(levelName);
	return levelName;
}

export function assertWorldName(levelName: string): void {
	if (levelName === "." || levelName === ".." || /[/\\\0]/.test(levelName)) {
		throw new Error(`Unsupported level-name: ${levelName}`);
	}
}

/** Rewrites only the level-name line, keeping line endings; appends it when absent. */
export function replaceLevelName(serverProperties: string, levelName: string): string {
	const eol = serverProperties.includes("\r\n") ? "\r\n" : "\n";
	const lines = serverProperties.split(/\r?\n/);
	let replaced = false;
	const updated = lines.map((line) => {
		const match = LEVEL_NAME_LINE.exec(line);
		if (!match || replaced) return line;
		replaced = true;
		return `${match[1]}${levelName}`;
	});
	if (!replaced) {
		if (updated.at(-1) === "") updated.splice(updated.length - 1, 0, `level-name=${levelName}`);
		else updated.push(`level-name=${levelName}`);
	}
	return updated.join(eol);
}

/** Reads the `S:additional_backup_files < ... >` list of serverutilities.cfg. */
export function parseAdditionalBackupFiles(config: string): string[] | undefined {
	const lines = config.split(/\r?\n/);
	const start = lines.findIndex((line) => /^\s*S:additional_backup_files\s*<\s*$/.test(line));
	if (start < 0) return undefined;
	const values: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^\s*>\s*$/.test(line)) return values;
		if (line.trim()) values.push(line.trim());
	}
	return undefined;
}

/**
 * Turns backup patterns into server-side path globs relative to the server root.
 * Client-only data is dropped; a trailing "/**" selects the whole matched entry.
 */
export function resolveDataGlobs(patterns: readonly string[], levelName: string): string[] {
	const globs = new Set<string>();
	for (const pattern of patterns) {
		const resolved = pattern
			.replaceAll("$WORLDNAME", levelName)
			.replace(/\/\*\*$/, "")
			.replace(/^\.\//, "");
		const segments = resolved.split("/");
		if (!resolved || resolved.startsWith("/") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
			throw new Error(`Unsupported world data path: ${pattern}`);
		}
		if (segments.includes("**") || segments[0] === "saves" || segments.includes("client")) continue;
		globs.add(resolved);
	}
	return [...globs];
}

/** Splits a glob into its literal leading directory and the number of segments to search below it. */
export function splitGlob(glob: string): { prefix: string; depth: number; expression: RegExp } {
	const segments = glob.split("/");
	const firstWildcard = segments.findIndex((segment) => /[*?]/.test(segment));
	const literalCount = firstWildcard < 0 ? segments.length : firstWildcard;
	const expression = new RegExp(
		`^${segments
			.map((segment) =>
				segment
					.split("")
					.map((character) => {
						if (character === "*") return "[^/]*";
						if (character === "?") return "[^/]";
						return character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
					})
					.join("")
			)
			.join("/")}$`
	);
	return {
		prefix: segments.slice(0, literalCount).join("/"),
		depth: segments.length - literalCount,
		expression,
	};
}

export type TreeStats = { files: number; bytes: number };

export function parseTreeStats(output: string): TreeStats {
	const [files, bytes] = output.trim().split(/\s+/).map(Number);
	if (!Number.isSafeInteger(files) || !Number.isSafeInteger(bytes) || files! < 0 || bytes! < 0) {
		throw new Error("Unable to measure copied data");
	}
	return { files: files!, bytes: bytes! };
}

export function assertSameStats(path: string, source: TreeStats, copy: TreeStats): void {
	if (source.files !== copy.files || source.bytes !== copy.bytes) {
		throw new Error(`Copy verification failed for ${path}: ${source.files} files / ${source.bytes} bytes expected, ${copy.files} / ${copy.bytes} copied`);
	}
}
