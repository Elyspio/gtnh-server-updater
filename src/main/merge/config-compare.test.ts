import { describe, expect, it } from "vite-plus/test";
import { compareConfigs, parseForgeConfig, parseJson, parseProperties } from "./config-compare";

const BASE_CFG = `# GregTech config
general {
    # Allow explosions [default: true]
    B:machineFireExplosions=true
    I:compression_level=1
    S:additional_backup_files <
        first
        second
     >
}
`;

describe("Forge configuration", () => {
	it("reads entries, list blocks and sections without comments or indentation", () => {
		const entries = parseForgeConfig(BASE_CFG);
		expect(entries.get("general/machineFireExplosions")).toBe("true");
		expect(entries.get("general/compression_level")).toBe("1");
		expect(entries.get("general/additional_backup_files")).toBe("first\nsecond");
	});

	it("treats an option added with its default value as a mod rewrite", () => {
		const rewritten = BASE_CFG.replace(
			"    I:compression_level=1",
			["    # Backup entire regions [default: false]", "    B:backup_entire_regions_with_claims=false", "", "        I:compression_level=1"].join("\n")
		);
		expect(compareConfigs("serverutilities/serverutilities.cfg", BASE_CFG, rewritten)).toBe("regenerated");
	});

	it("reports a value the user changed on an existing key", () => {
		const edited = BASE_CFG.replace("I:compression_level=1", "I:compression_level=9");
		expect(compareConfigs("serverutilities/serverutilities.cfg", BASE_CFG, edited)).toBe("changed");
	});

	it("ignores reworded comments, reordered lists and requoted keys", () => {
		const rewritten = BASE_CFG.replace("# Allow explosions [default: true]", "# Allow machine explosions caused by fire [default: true]")
			.replace("B:machineFireExplosions=true", 'B:"machineFireExplosions"=true')
			.replace("        first\n        second", "        second\n        first");
		expect(compareConfigs("config/GregTech/GregTech.cfg", BASE_CFG, rewritten)).toBe("regenerated");
	});

	it("ignores version keys bumped by mod updates", () => {
		const base = "general {\n    S:~CONFIG_VERSION=2.0.5\n    S:version=7.1.59\n}\n";
		const bumped = "general {\n    S:~CONFIG_VERSION=2.0.6\n    S:version=7.1.63\n}\n";
		expect(compareConfigs("config/fether.cfg", base, bumped)).toBe("regenerated");
	});
});

describe("properties and JSON", () => {
	it("compares server.properties per key", () => {
		const base = "#Minecraft server properties\nlevel-name=World\nmotd=GTNH\nview-distance=8\n";
		expect(parseProperties(base).get("view-distance")).toBe("8");
		expect(compareConfigs("server.properties", base, base.replace("view-distance=8", "view-distance=16"))).toBe("changed");
		expect(compareConfigs("server.properties", base, `#other header\n${base.split("\n").reverse().join("\n")}`)).toBe("regenerated");
	});

	it("ignores JSON formatting and array order", () => {
		const base = '[{"uuid":"a","name":"Ann"},{"uuid":"b","name":"Bob"}]';
		expect(parseJson('{"a":{"b":1}}').get("/a/b")).toBe("1");
		expect(compareConfigs("ops.json", base, '[{"uuid":"b","name":"Bob"},\n {"uuid":"a","name":"Ann"}]')).toBe("regenerated");
		expect(compareConfigs("ops.json", base, '[{"uuid":"a","name":"Ann"},{"uuid":"c","name":"Cid"}]')).toBe("changed");
	});

	it("falls back to byte comparison for unknown or unparsable files", () => {
		expect(compareConfigs("startserver.sh", "echo a", "echo b")).toBe("unknown-format");
		expect(compareConfigs("ops.json", "[", "]")).toBe("unknown-format");
		expect(compareConfigs("empty.cfg", "", "")).toBe("unknown-format");
	});
});
