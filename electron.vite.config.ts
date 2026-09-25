import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const sharedAlias = { "@shared": resolve("src/shared") };

// electron-vite 5 externalizes dependencies by default for main and preload (build.externalizeDeps).
export default defineConfig({
	main: { resolve: { alias: sharedAlias } },
	preload: { resolve: { alias: sharedAlias } },
	renderer: { resolve: { alias: sharedAlias }, plugins: [react()] },
});
