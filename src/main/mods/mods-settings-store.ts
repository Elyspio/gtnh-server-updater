import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ModSource, ModsSettings } from "@shared/mods.types";

type StoredSettings = { prismDirectory?: string; sources?: Record<string, { folder: string; name?: string }> };

/** Remembers where each modid's JAR came from, and an optional Prism instances folder. */
export class ModsSettingsStore {
	public constructor(
		private readonly file: string,
		private readonly defaultPrismDirectory: () => string
	) {}

	public get(): ModsSettings {
		const stored = this.read();
		const sources: ModSource[] = Object.entries(stored.sources ?? {})
			.filter(([, source]) => typeof source?.folder === "string")
			.map(([modId, source]) => ({ modId, folder: source.folder, name: source.name }))
			.sort((left, right) => left.modId.localeCompare(right.modId));
		return {
			prismDirectory: stored.prismDirectory || this.defaultPrismDirectory(),
			prismDirectoryIsDefault: !stored.prismDirectory,
			sources,
		};
	}

	public source(modId: string): ModSource | undefined {
		return this.get().sources.find((source) => source.modId === modId);
	}

	public async rememberSource(modId: string, folder: string, name?: string): Promise<ModsSettings> {
		const stored = this.read();
		await this.write({ ...stored, sources: { ...stored.sources, [modId]: { folder, name } } });
		return this.get();
	}

	public async forgetSource(modId: string): Promise<ModsSettings> {
		const stored = this.read();
		const sources = { ...stored.sources };
		delete sources[modId];
		await this.write({ ...stored, sources });
		return this.get();
	}

	/** An empty value goes back to the detected default. */
	public async setPrismDirectory(directory: string | null): Promise<ModsSettings> {
		const stored = this.read();
		await this.write({ ...stored, prismDirectory: directory?.trim() || undefined });
		return this.get();
	}

	private read(): StoredSettings {
		if (!existsSync(this.file)) return {};
		const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as StoredSettings) : {};
	}

	private async write(settings: StoredSettings): Promise<void> {
		await mkdir(path.dirname(this.file), { recursive: true });
		const temporary = `${this.file}.tmp`;
		await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
		await rename(temporary, this.file);
	}
}
