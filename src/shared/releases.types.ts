export type ReleaseAsset = {
  name: string;
  /** Download URL on the GTNH releases host; the Linux server fetches it over HTTPS. */
  url: string;
  size: number;
};

export type ReleaseSummary = {
  tag: string;
  name: string;
  publishedAt: string;
  assets: ReleaseAsset[];
  /** The server archive for Java 17 when exactly one matches. */
  recommended?: ReleaseAsset;
};

export type LatestRelease = {
  tag: string;
  /** ISO date published by GitHub, empty when the release carries none. */
  publishedAt: string;
};

/** Newest published version per repository; null when GitHub could not answer for that one. */
export type LatestVersions = {
  /** GTNH daily builds, the archives this app deploys. */
  dailyBuild: LatestRelease | null;
  /** The main modpack repository, whose releases name the version a folder usually follows. */
  modpack: LatestRelease | null;
};
