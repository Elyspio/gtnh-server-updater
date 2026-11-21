import { z } from "zod";
import type { ModBackup, ModBackupRecord } from "@shared/mods.types";

/** Backups live next to `mods/`, never inside it: Forge would load a JAR left there. */
export const BACKUP_DIRECTORY = "mods-backup";
export const BACKUP_RECORD = "installed.json";
/** Besides the original of the current chain, the most recent backups kept per modid. */
export const RECENT_BACKUPS = 4;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const relativeJar = z
	.string()
	.regex(/^mods\/(?:1\.7\.10\/)?[^/\\\0]+\.jar$/i)
	.refine((value) => !value.split("/").includes(".."), "Invalid path");

const recordSchema: z.ZodType<ModBackupRecord> = z.object({
	version: z.literal(1),
	modId: z.string().min(1).max(64),
	originalFile: relativeJar,
	originalSha256: sha256,
	installedFile: relativeJar,
	installedSha256: sha256,
	createdAt: z.string().max(64),
});

export function parseBackupRecord(text: string): ModBackupRecord {
	return recordSchema.parse(JSON.parse(text));
}

/** Sortable and readable: 20261121T150700123Z. */
export function newBackupId(now: Date): string {
	return now.toISOString().replace(/[-:.]/g, "");
}

export function isBackupId(value: string): boolean {
	return /^\d{8}T\d{9}Z$/.test(value);
}

export function sortBackups(backups: ModBackup[]): ModBackup[] {
	return [...backups].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Index of the backup holding the original of the latest chain. A chain breaks when a
 * backup's original is not what the app installed just before: the mod was updated by
 * other means (a new GTNH version), and older backups belong to another version.
 */
export function chainStart(sorted: ModBackup[]): number {
	for (let index = sorted.length - 1; index > 0; index--) {
		if (sorted[index]!.record.originalSha256 !== sorted[index - 1]!.record.installedSha256) return index;
	}
	return 0;
}

/** The original to restore, only while the JAR in place is the one the app installed last. */
export function restoreSource(sorted: ModBackup[], currentSha256: string): ModBackup | undefined {
	const latest = sorted.at(-1);
	if (!latest || latest.record.installedSha256 !== currentSha256) return undefined;
	return sorted[chainStart(sorted)];
}

/** Older chains go, and within the latest chain only its original and the recent backups stay. */
export function backupsToPrune(sorted: ModBackup[]): ModBackup[] {
	const start = chainStart(sorted);
	return sorted.filter((_backup, index) => index !== start && index < sorted.length - RECENT_BACKUPS);
}
