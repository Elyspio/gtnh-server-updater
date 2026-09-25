import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolvePreloadPath } from "./preload-path";

describe("resolvePreloadPath", () => {
	it("targets a CommonJS preload compatible with Electron sandboxing", () => {
		const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as { type?: string };
		const resolved = resolvePreloadPath(path.join("app", "out", "main"));
		expect(packageJson.type).not.toBe("module");
		expect(path.basename(resolved)).toBe("index.js");
	});
});
