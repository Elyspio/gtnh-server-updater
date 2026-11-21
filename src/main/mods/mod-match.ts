import type { ModInfo } from "./mod-info";
import { parseModInfo } from "./mod-info";

/** A JAR found in a target's mods folder, with the mods its mcmod.info declares. */
export type ScannedJar = { relativePath: string; mods: ModInfo[] };

export type ModMatch = { status: "absent" } | { status: "ambiguous"; files: string[] } | { status: "found"; jar: ScannedJar; version?: string };

/** Forge loads `mods/` and `mods/1.7.10/`; a modid must be provided by exactly one JAR there. */
export const MOD_FOLDERS = ["mods", "mods/1.7.10"] as const;

export function matchMod(jars: ScannedJar[], modId: string): ModMatch {
	const matches = jars.filter((jar) => jar.mods.some((mod) => mod.modId === modId));
	if (matches.length === 0) return { status: "absent" };
	if (matches.length > 1) return { status: "ambiguous", files: matches.map((jar) => jar.relativePath).sort() };
	const jar = matches[0]!;
	return { status: "found", jar, version: jar.mods.find((mod) => mod.modId === modId)?.version };
}

export const JAR_MARKER = "@@GTNH-JAR@@";

/** Shell loop printing each JAR's relative path followed by its mcmod.info (bounded). */
export function scanJarsScript(): string {
	return [
		`for f in ${MOD_FOLDERS.map((folder) => `${folder}/*.jar`).join(" ")}; do`,
		'  [ -f "$f" ] || continue',
		`  printf '\\n%s%s\\n' '${JAR_MARKER}' "$f"`,
		'  unzip -p "$f" mcmod.info 2>/dev/null | head -c 262144',
		"done",
	].join("\n");
}

export function parseScannedJars(output: string): ScannedJar[] {
	return output
		.split(`\n${JAR_MARKER}`)
		.slice(1)
		.map((chunk) => {
			const newline = chunk.indexOf("\n");
			const relativePath = (newline < 0 ? chunk : chunk.slice(0, newline)).trim();
			const content = newline < 0 ? "" : chunk.slice(newline + 1);
			return { relativePath, mods: content.trim() ? parseModInfo(content) : [] };
		})
		.filter((jar) => jar.relativePath.length > 0);
}
