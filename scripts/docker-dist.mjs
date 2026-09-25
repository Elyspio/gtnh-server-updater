/**
 * Builds the Windows installer and the Linux packages in one Docker container.
 *
 *   node scripts/docker-dist.mjs            -> dist/ (no publishing)
 *   node scripts/docker-dist.mjs --publish  -> also publishes to GitHub releases (needs GH_TOKEN)
 *
 * Sources are copied into the container (host node_modules, out and dist are ignored) and
 * dependencies are installed there; pnpm, Electron and electron-builder caches live in named
 * volumes so later builds do not download them again.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const image = "gtnh-server-updater-builder";
const publish = process.argv.includes("--publish");

if (publish && !process.env.GH_TOKEN) {
  console.error("GH_TOKEN must be set to publish a release.");
  process.exit(1);
}

const containerScript = [
  "set -euo pipefail",
  "cd /project",
  "tar --exclude=./node_modules --exclude=./out --exclude=./dist --exclude=./.git --exclude=./.idea --exclude=./.scratch -cf - . | tar -C /work -xf -",
  "cd /work",
  "pnpm config set store-dir /pnpm-store >/dev/null",
  "pnpm install --frozen-lockfile",
  "pnpm exec electron-vite build",
  `pnpm exec electron-builder --linux AppImage deb --win nsis --x64 --publish ${publish ? "always" : "never"}`,
  "find dist -maxdepth 1 -type f \\( -name '*.exe' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.blockmap' -o -name 'latest*.yml' \\) -exec cp -f {} /output/ \\;",
  "ls -la /output",
].join("\n");

function docker(args) {
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync(output, { recursive: true });
docker(["build", "-t", image, path.join(root, "docker")]);
docker([
  "run", "--rm",
  "-v", `${root}:/project:ro`,
  "-v", `${output}:/output`,
  "-v", "gtnh-updater-pnpm-store:/pnpm-store",
  "-v", "gtnh-updater-electron-cache:/root/.cache/electron",
  "-v", "gtnh-updater-builder-cache:/root/.cache/electron-builder",
  ...(publish ? ["-e", "GH_TOKEN"] : []),
  image,
  "bash", "-c", containerScript,
]);
console.log(`Artifacts written to ${output}`);
