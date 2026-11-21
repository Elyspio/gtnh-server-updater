export type ModInfo = { modId: string; name?: string; version?: string };

const MOD_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Reads the mods declared by an mcmod.info: a bare list or `{ modListVersion: 2, modList }`.
 * Some mods ship a file that is not strict JSON; their modids are still found by pattern.
 */
export function parseModInfo(text: string): ModInfo[] {
	const content = text.replace(/^﻿/, "");
	let entries: unknown[];
	try {
		const parsed: unknown = JSON.parse(content);
		entries = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.modList) ? parsed.modList : [];
	} catch {
		entries = [...content.matchAll(/"modid"\s*:\s*"([^"]*)"/g)].map((match) => ({ modid: match[1] }));
	}
	const mods = new Map<string, ModInfo>();
	for (const entry of entries) {
		if (!isRecord(entry) || typeof entry.modid !== "string") continue;
		const modId = entry.modid.trim();
		if (!modId || mods.has(modId)) continue;
		mods.set(modId, { modId, name: optionalText(entry.name), version: optionalText(entry.version) });
	}
	return [...mods.values()];
}

/** A modid is used as a folder name for backups, so only plain names are accepted. */
export function assertSafeModId(modId: string): string {
	if (!MOD_ID.test(modId) || modId === "." || modId === "..") throw new Error(`Unsupported modid "${modId}": only letters, digits, dot, dash and underscore`);
	return modId;
}

/** The JAR chosen to replace a mod must declare exactly one modid. */
export function singleMod(mods: ModInfo[], fileName: string): ModInfo {
	if (mods.length === 0) throw new Error(`${fileName} has no mcmod.info modid`);
	if (mods.length > 1) throw new Error(`${fileName} declares several mods (${mods.map((mod) => mod.modId).join(", ")}); only single-mod JARs can replace a mod`);
	assertSafeModId(mods[0]!.modId);
	return mods[0]!;
}

/** A file name the app writes into `mods/`: a plain `.jar` name, never hidden. */
export function assertJarFileName(fileName: string): string {
	if (!/^[^/\\\0]+\.jar$/i.test(fileName) || fileName.startsWith(".")) throw new Error(`Unsupported JAR file name: ${fileName}`);
	return fileName;
}

function optionalText(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
