import { RemoteClient, quoteShell } from "../ssh/remote-client";
import { DEFAULT_WORLD_DATA_PATTERNS, parseAdditionalBackupFiles, parseLevelName, parseTreeStats, resolveDataGlobs, splitGlob, type TreeStats } from "./migration-policy";

const MAX_CONFIG_BYTES = 1024 * 1024;

export type WorldData = {
	worldName: string;
	/** Other top-level folders holding a level.dat; never copied. */
	ignoredWorlds: string[];
	/** Existing server-side paths outside the world folder, relative to the server root. */
	dataPaths: string[];
	missingDataPaths: string[];
	dataListWarning?: string;
};

export async function resolveWorldData(client: RemoteClient, serverRoot: string): Promise<WorldData> {
	const properties = await readTextFile(client, `${serverRoot}/server.properties`);
	if (properties === undefined) throw new Error("The old server has no server.properties");
	const worldName = parseLevelName(properties);
	if ((await client.execute(`test -f ${quoteShell(`${serverRoot}/${worldName}/level.dat`)}`)).exitCode !== 0) {
		throw new Error(`World folder "${worldName}" with a level.dat was not found in the old server`);
	}
	const ignoredWorlds = (await findWorldDirectories(client, serverRoot)).filter((name) => name !== worldName);

	const config = await readTextFile(client, `${serverRoot}/serverutilities/serverutilities.cfg`);
	const configured = config === undefined ? undefined : parseAdditionalBackupFiles(config);
	const dataListWarning = configured === undefined ? "serverutilities.cfg has no additional_backup_files list; the GTNH default list of world data paths is used." : undefined;
	const globs = resolveDataGlobs(configured ?? DEFAULT_WORLD_DATA_PATTERNS, worldName);

	const dataPaths: string[] = [];
	const missingDataPaths: string[] = [];
	for (const glob of globs) {
		const matches = await expandGlob(client, serverRoot, glob);
		if (matches.length === 0) missingDataPaths.push(glob);
		for (const match of matches) {
			if (match !== worldName && !match.startsWith(`${worldName}/`) && !dataPaths.includes(match)) dataPaths.push(match);
		}
	}
	return { worldName, ignoredWorlds, dataPaths, missingDataPaths, dataListWarning };
}

/** World directories are top-level folders holding a level.dat. */
export async function findWorldDirectories(client: RemoteClient, serverRoot: string): Promise<string[]> {
	const output = await client.executeChecked(`cd ${quoteShell(serverRoot)} && find . -mindepth 2 -maxdepth 2 -type f -name level.dat`);
	return output
		.split("\n")
		.filter(Boolean)
		.map((line) => line.replace(/^\.\//, "").split("/")[0]!)
		.filter(Boolean);
}

export async function measureTree(client: RemoteClient, root: string, relativePath: string): Promise<TreeStats> {
	return parseTreeStats(
		await client.executeTrackedChecked(`cd ${quoteShell(root)} && find ${quoteShell(`./${relativePath}`)} -type f -printf '%s\\n' | awk '{n++; s+=$1} END {print n+0, s+0}'`)
	);
}

export async function assertNoSymbolicLinks(client: RemoteClient, root: string, relativePath: string): Promise<void> {
	const found = (
		await client.executeChecked(`cd ${quoteShell(root)} && find ${quoteShell(`./${relativePath}`)} \\( -type l -o \\( ! -type f ! -type d \\) \\) -print -quit`)
	).trim();
	if (found) throw new Error(`Symbolic links and special files are not supported: ${found.replace(/^\.\//, "")}`);
}

async function expandGlob(client: RemoteClient, serverRoot: string, glob: string): Promise<string[]> {
	const { prefix, depth, expression } = splitGlob(glob);
	const target = `./${prefix}`;
	if (depth === 0) {
		const exists = (await client.execute(`cd ${quoteShell(serverRoot)} && test -e ${quoteShell(target)}`)).exitCode === 0;
		return exists ? [prefix] : [];
	}
	const result = await client.execute(`cd ${quoteShell(serverRoot)} && test -d ${quoteShell(target)} && find ${quoteShell(target)} -mindepth ${depth} -maxdepth ${depth}`);
	if (result.exitCode !== 0) return [];
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => line.replace(/^\.\//, ""))
		.filter((path) => expression.test(path))
		.sort();
}

export async function readTextFile(client: RemoteClient, remotePath: string): Promise<string | undefined> {
	if ((await client.execute(`test -f ${quoteShell(remotePath)}`)).exitCode !== 0) return undefined;
	const file = await client.readFile(remotePath, MAX_CONFIG_BYTES);
	if (!file.content) throw new Error(`${remotePath} is too large`);
	return file.content.toString("utf8");
}
