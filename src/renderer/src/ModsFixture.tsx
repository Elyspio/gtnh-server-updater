import { useState } from "react";
import type { SshConnectionInput } from "@shared/deployment.types";
import type { ModJar, ModsInspectResult, ModsSettings } from "@shared/mods.types";
import { ModsPanel } from "./ModsPanel";

const CONNECTION: SshConnectionInput = { host: "gtnh.example.test", port: 22, username: "root", privateKeyPath: "C:/keys/id_ed25519" };
const FOLDER = "C:/dev/MatterManipulator/build/libs";

const SETTINGS: ModsSettings = {
	prismDirectory: "C:/Users/player/AppData/Roaming/PrismLauncher/instances",
	prismDirectoryIsDefault: true,
	sources: [{ modId: "matter-manipulator", folder: FOLDER, name: "Matter Manipulator" }],
};

const V1 = "0.2.1-GTNH-master+51ef032bde-dirty";
const V2 = "0.2.2-GTNH-feat-portable-blueprints.1+7b65685991-dirty";
const build = (fileName: string, version: string, at: string, kib: number, sha256: string): ModJar => ({
	path: `${FOLDER}/${fileName}`,
	fileName,
	modId: "matter-manipulator",
	name: "Matter Manipulator",
	version,
	sizeBytes: kib * 1024,
	modifiedAt: Date.parse(at),
	sha256,
});

/** The build folder of a fork with several feature builds per release. */
const JARS: ModJar[] = [
	build("matter-manipulator-0.2.2-blueprints-multiparts.jar", V2, "2026-11-17T12:54:00", 958, "c8"),
	build(`matter-manipulator-${V2}.jar`, V2, "2026-11-17T12:54:00", 958, "c8"),
	build("matter-manipulator-0.2.2-blueprints-review-fixes.jar", V2, "2026-11-16T22:14:00", 945, "dd"),
	build("matter-manipulator-0.2.2-blueprints-visualizer.jar", V2, "2026-11-16T04:20:00", 934, "1d"),
	build("matter-manipulator-0.2.2-blueprints-ui.jar", V2, "2026-11-16T03:53:00", 913, "4e"),
	build("matter-manipulator-0.2.1-blueprints-review-fixes.jar", V1, "2026-11-16T01:30:00", 829, "63"),
	build(`matter-manipulator-${V1}.jar`, V1, "2026-11-16T01:30:00", 829, "63"),
];

const INSPECTION: ModsInspectResult = {
	modId: "matter-manipulator",
	server: {
		state: {
			serviceName: "gtnh",
			serverPath: "/data/gtnh/2.9.0",
			serviceState: "active",
			state: {
				status: "ready",
				current: { relativePath: "mods/matter-manipulator-0.1.75-GTNH.jar", fileName: "matter-manipulator-0.1.75-GTNH.jar", version: "0.1.75", sha256: "fa" },
			},
		},
	},
	instances: [
		{
			id: "gtnh-290",
			name: "GT New Horizons 2.9.0",
			directory: "",
			state: {
				status: "ready",
				current: { relativePath: "mods/matter-manipulator-0.1.75-GTNH.jar", fileName: "matter-manipulator-0.1.75-GTNH.jar", version: "0.1.75", sha256: "fa" },
			},
		},
		{ id: "gtnh-java17", name: "GT_New_Horizons_2.9.0_Java_17-26", directory: "", state: { status: "running" } },
		{
			id: "mm-test",
			name: "Codex-MM-Blueprints-Test",
			directory: "",
			state: {
				status: "ready",
				current: {
					relativePath: "mods/matter-manipulator-0.2.2-blueprints-multiparts.jar",
					fileName: "matter-manipulator-0.2.2-blueprints-multiparts.jar",
					version: V2,
					sha256: "c8",
				},
				restore: { backupId: "20261117T130000000Z", fileName: "matter-manipulator-0.1.75-GTNH.jar" },
			},
		},
	],
};

const RESPONSES: Record<string, unknown> = { "mods:settings": SETTINGS, "mods:list-source": JARS, "mods:inspect": INSPECTION };

/** Installs a stubbed bridge when the fixture runs outside Electron. */
export function installModsBridge(): void {
	if (typeof window.gtnh === "object") return;
	window.gtnh = {
		invoke: async (channel: string) => RESPONSES[channel] ?? null,
		on: () => () => undefined,
	} as Window["gtnh"];
}

/** Shows the Mods panel on a connected server with a stubbed bridge (app with ?fixture=mods). */
export function ModsFixture(): React.JSX.Element {
	const [serviceName, setServiceName] = useState("gtnh");
	return (
		<main className="sheet">
			<ModsPanel connection={CONNECTION} serverReady serviceName={serviceName} onServiceNameChange={setServiceName} onRunStart={() => undefined} connectionPanel={null} />
		</main>
	);
}
