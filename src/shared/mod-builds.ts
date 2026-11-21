import type { ModJar } from "./mods.types";

/**
 * The release a build belongs to: the leading dotted number of its mcmod.info version, so
 * `0.2.2-GTNH-feat-portable-blueprints.1+7b65685991-dirty` and a renamed copy of it both count as 0.2.2.
 */
export function releaseOf(jar: ModJar): string {
	return releaseName(jar.version) ?? "no version";
}

/** `0.2.2-GTNH-feat+7b65685991-dirty` reads as `0.2.2`; a version without a leading number is kept as is. */
export function releaseName(version: string | undefined): string | undefined {
	const trimmed = version?.trim();
	if (!trimmed) return undefined;
	return /^\d+(?:\.\d+)*/.exec(trimmed)?.[0] ?? trimmed;
}

export type ModRelease = { release: string; jar: ModJar; otherBuilds: number };

/** One entry per release: its newest build, and how many other distinct builds of it exist. */
export function latestPerRelease(jars: ModJar[]): ModRelease[] {
	const releases = new Map<string, ModJar[]>();
	for (const jar of jars) releases.set(releaseOf(jar), [...(releases.get(releaseOf(jar)) ?? []), jar]);
	return [...releases.entries()]
		.map(([release, builds]) => {
			const sorted = builds.toSorted((left, right) => right.modifiedAt - left.modifiedAt || left.fileName.localeCompare(right.fileName));
			const newest = sorted[0] as ModJar;
			return { release, jar: newest, otherBuilds: new Set(sorted.map((build) => build.sha256).filter((sha) => sha !== newest.sha256)).size };
		})
		.toSorted((left, right) => compareReleases(right.release, left.release));
}

function compareReleases(left: string, right: string): number {
	const a = left.split(".").map(Number);
	const b = right.split(".").map(Number);
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (Number.isNaN(difference)) return left.localeCompare(right);
		if (difference !== 0) return difference;
	}
	return 0;
}
