import { z } from "zod";
import type { LatestRelease, LatestVersions, ReleaseAsset, ReleaseSummary } from "@shared/releases.types";
import { log } from "../logger";

const REPOSITORY = "GTNewHorizons/GTNH-Daily-Builds";
/** Only names versions: its releases ship the modpack zip, never a server archive. */
const MODPACK_REPOSITORY = "GTNewHorizons/GT-New-Horizons-Modpack";
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=50`;
const latestApi = (repository: string): string => `https://api.github.com/repos/${repository}/releases/latest`;
/** Assets must come from this repository's releases: the URL is later downloaded by the server. */
const DOWNLOAD_PREFIX = `https://github.com/${REPOSITORY}/releases/download/`;
const SERVER_JAVA17 = /server.*java17.*\.zip$/i;
const REQUEST_TIMEOUT_MS = 15_000;
/** The hint is informational: a short cache keeps step changes off GitHub's rate limit. */
const LATEST_CACHE_MS = 10 * 60_000;

/** GitHub answers are data, never instructions: only the fields below are read. */
const releasesSchema = z.array(
	z.object({
		tag_name: z.string().max(200),
		name: z.string().max(400).nullish(),
		published_at: z.string().max(64).nullish(),
		draft: z.boolean().nullish(),
		assets: z
			.array(
				z.object({
					name: z.string().max(400),
					browser_download_url: z.string().max(2048),
					size: z.number().nonnegative(),
				})
			)
			.default([]),
	})
);

const latestSchema = z.object({
	tag_name: z.string().max(200),
	published_at: z.string().max(64).nullish(),
});

let latestCache: { readAt: number; versions: LatestVersions } | undefined;

/** Newest version of each repository, for naming the destination folder; never throws. */
export async function readLatestVersions(): Promise<LatestVersions> {
	if (latestCache && Date.now() - latestCache.readAt < LATEST_CACHE_MS) return latestCache.versions;

	const [dailyBuild, modpack] = await Promise.all([readLatest(REPOSITORY), readLatest(MODPACK_REPOSITORY)]);
	const versions: LatestVersions = { dailyBuild, modpack };
	// A total failure is usually transient; caching it would hide the next success for ten minutes.
	if (dailyBuild || modpack) latestCache = { readAt: Date.now(), versions };
	return versions;
}

async function readLatest(repository: string): Promise<LatestRelease | null> {
	try {
		const response = await fetch(latestApi(repository), {
			headers: { accept: "application/vnd.github+json", "user-agent": "gtnh-server-updater" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) {
			log("info", `Latest release of ${repository} unavailable (HTTP ${response.status})`);
			return null;
		}
		const parsed = latestSchema.safeParse(await response.json());
		if (!parsed.success) return null;
		return { tag: parsed.data.tag_name, publishedAt: parsed.data.published_at ?? "" };
	} catch (error) {
		log("info", `Latest release of ${repository} could not be read: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
}

export async function listGtnhReleases(): Promise<ReleaseSummary[]> {
	const response = await fetchReleases();
	if (!response.ok) throw new Error(describeFailure(response));
	const parsed = releasesSchema.safeParse(await response.json());
	if (!parsed.success) throw new Error("GitHub returned an unexpected release list");

	const releases = parsed.data
		.filter((release) => !release.draft)
		.map((release): ReleaseSummary => {
			const assets = release.assets
				.filter((asset) => asset.name.toLowerCase().endsWith(".zip") && asset.browser_download_url.startsWith(DOWNLOAD_PREFIX))
				.map((asset): ReleaseAsset => ({ name: asset.name, url: asset.browser_download_url, size: asset.size }));
			const serverArchives = assets.filter((asset) => SERVER_JAVA17.test(asset.name));
			return {
				tag: release.tag_name,
				name: release.name?.trim() || release.tag_name,
				publishedAt: release.published_at ?? "",
				assets,
				recommended: serverArchives.length === 1 ? serverArchives[0] : undefined,
			};
		})
		.filter((release) => release.assets.length > 0);

	log("info", `Listed ${releases.length} GTNH releases`);
	return releases;
}

async function fetchReleases(): Promise<Response> {
	try {
		return await fetch(RELEASES_API, {
			headers: { accept: "application/vnd.github+json", "user-agent": "gtnh-server-updater" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`GTNH releases could not be reached: ${error instanceof Error ? error.message : String(error)}. Use a local ZIP or an HTTPS URL instead.`);
	}
}

function describeFailure(response: Response): string {
	if (response.status === 403 || response.status === 429) {
		return "GitHub is rate-limiting this machine; try again later, or use a local ZIP or an HTTPS URL.";
	}
	return `GTNH releases could not be listed (HTTP ${response.status}). Use a local ZIP or an HTTPS URL instead.`;
}
