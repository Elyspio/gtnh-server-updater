import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { App } from "./App";
import { ArchiveSourceFixture, installArchiveSourceBridge } from "./ArchiveSourceFixture";
import { ConnectionFixture, installConnectionBridge } from "./ConnectionFixture";
import { MergeListFixture } from "./MergeListFixture";
import { ModsFixture, installModsBridge } from "./ModsFixture";
import { RemotePathsFixture, installRemotePathsBridge } from "./RemotePathsFixture";

import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import { theme } from "./theme";

const fixture = new URLSearchParams(window.location.search).get("fixture");
const fixtureBridges: Record<string, () => void> = {
	"archive-source": installArchiveSourceBridge,
	connection: installConnectionBridge,
	mods: installModsBridge,
	"remote-paths": installRemotePathsBridge,
};
if (fixture) fixtureBridges[fixture]?.();
/** Keeps the editor out of the main bundle. */
const MergeReviewFixture = lazy(async () => ({ default: (await import("./MergeReviewFixture")).MergeReviewFixture }));

const content =
	fixture === "merge-list" ? (
		<MergeListFixture />
	) : fixture === "archive-source" ? (
		<ArchiveSourceFixture />
	) : fixture === "connection" ? (
		<ConnectionFixture />
	) : fixture === "mods" ? (
		<ModsFixture />
	) : fixture === "remote-paths" ? (
		<RemotePathsFixture />
	) : fixture === "merge-review" ? (
		<Suspense fallback={null}>
			<MergeReviewFixture />
		</Suspense>
	) : typeof window.gtnh === "object" ? (
		<App />
	) : (
		<main className="startup-failure">
			<h1>GTNH Server Updater could not start</h1>
			<p>The secure desktop bridge did not load. Restart the application or reinstall this build.</p>
		</main>
	);

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ThemeProvider theme={theme}>
			<CssBaseline />
			{content}
		</ThemeProvider>
	</React.StrictMode>
);
