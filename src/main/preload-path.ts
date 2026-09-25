import { join } from "node:path";

export function resolvePreloadPath(mainDirectory: string): string {
	return join(mainDirectory, "../preload/index.js");
}
