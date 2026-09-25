import { resolve } from "node:path";
import { defaultFmtConfig, defaultLintConfig } from "@elyspio/vite-eslint-config";
import { defineConfig } from "vite-plus";

// Build, dev and preview run through electron-vite (electron.vite.config.ts).
// This file only drives `vp fmt`, `vp lint`, `vp check` and `vp test`.
const ignorePatterns = ["out/**", ".scratch/**", ".idea/**", "pnpm-workspace.yaml"];

export default defineConfig({
	resolve: { alias: { "@shared": resolve(import.meta.dirname, "src/shared") } },
	fmt: {
		...defaultFmtConfig,
		ignorePatterns: [...defaultFmtConfig.ignorePatterns, ...ignorePatterns],
	},
	lint: {
		...defaultLintConfig,
		ignorePatterns: [...defaultLintConfig.ignorePatterns, ...ignorePatterns],
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
