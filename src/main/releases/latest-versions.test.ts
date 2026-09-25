import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ok = (tag: string, publishedAt: string): Response =>
  new Response(JSON.stringify({ tag_name: tag, published_at: publishedAt }), { status: 200 });

async function loadModule(): Promise<typeof import("./gtnh-releases")> {
  vi.resetModules();
  return await import("./gtnh-releases");
}

describe("readLatestVersions", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("reads the newest tag of both repositories", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) =>
      String(input).includes("GTNH-Daily-Builds")
        ? ok("daily-2026-09-20+747", "2026-09-20T09:03:12Z")
        : ok("2.8.4", "2025-12-23T12:21:00Z"));

    const { readLatestVersions } = await loadModule();
    expect(await readLatestVersions()).toEqual({
      dailyBuild: { tag: "daily-2026-09-20+747", publishedAt: "2026-09-20T09:03:12Z" },
      modpack: { tag: "2.8.4", publishedAt: "2025-12-23T12:21:00Z" },
    });
  });

  it("returns null for a repository GitHub refuses instead of failing the panel", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) =>
      String(input).includes("GTNH-Daily-Builds")
        ? ok("daily-2026-09-20+747", "")
        : new Response("rate limited", { status: 403 }));

    const { readLatestVersions } = await loadModule();
    expect(await readLatestVersions()).toEqual({
      dailyBuild: { tag: "daily-2026-09-20+747", publishedAt: "" },
      modpack: null,
    });
  });

  it("returns nulls when the network is unreachable", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

    const { readLatestVersions } = await loadModule();
    expect(await readLatestVersions()).toEqual({ dailyBuild: null, modpack: null });
  });

  it("serves a second call from the cache, and never caches a total failure", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new Error("offline"));
    const { readLatestVersions } = await loadModule();
    await readLatestVersions();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockImplementation(async () => ok("daily-2026-09-20+747", ""));
    await readLatestVersions();
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await readLatestVersions();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
