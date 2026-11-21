import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import { alignServerAccessScript, preserveAccessScript } from "./server-access";

// Native Linux filesystems are required. On Windows, opt into a local WSL fixture:
// $env:GTNH_ACCESS_TEST_WSL='1'; pnpm test run src/main/ssh/server-access.test.ts
const useWsl = process.platform === "win32" && process.env.GTNH_ACCESS_TEST_WSL === "1";

function shell(script: string): string {
	return execFileSync(useWsl ? "wsl.exe" : "sh", useWsl ? ["--user", "root", "--exec", "sh", "-s"] : ["-s"], {
		input: [
			"set -eu",
			"fixture=$(mktemp -d)",
			// This is a newly created /tmp fixture, never a user-provided directory.
			'trap \'chmod -R u+rwX "$fixture"; rm -rf -- "$fixture"\' 0',
			'cd "$fixture"',
			"mkdir old new",
			script,
		].join("\n"),
		encoding: "utf8",
		timeout: 20_000,
	}).trim();
}

describe.skipIf(process.platform === "win32" && !useWsl)("server access on a Linux filesystem", () => {
	it("matches old permissions and gives new files the nearest old directory's access", () => {
		const result = shell(
			[
				"mkdir old/config new/config new/config/nested new/mods",
				"printf old > old/config/private.cfg; printf new > new/config/private.cfg",
				"printf jar > new/config/nested/mod.jar; printf jar > new/mods/new.jar",
				"printf script > new/config/nested/start.sh",
				"chmod 2750 old; chmod 2770 old/config; chmod 600 old/config/private.cfg",
				"chmod 644 new/config/private.cfg new/config/nested/mod.jar new/mods/new.jar",
				"chmod 755 new/config/nested/start.sh",
				// Distinct ownership for existing paths is preserved when the fixture can chown.
				'if [ "$(id -u)" = 0 ]; then chown 1234:1235 old; chown 1240:1241 old/config old/config/private.cfg; fi',
				'old_stats=$(stat -c "%u:%g:%a" old old/config old/config/private.cfg)',
				alignServerAccessScript("old", "new"),
				'stat -c "%a" new new/config new/config/private.cfg new/config/nested new/config/nested/mod.jar new/config/nested/start.sh new/mods new/mods/new.jar',
				'[ "$(stat -c "%u:%g" old)" = "$(stat -c "%u:%g" new/mods/new.jar)" ]',
				'[ "$(stat -c "%u:%g" old/config)" = "$(stat -c "%u:%g" new/config/nested/mod.jar)" ]',
				'[ "$(stat -c "%u:%g" old/config/private.cfg)" = "$(stat -c "%u:%g" new/config/private.cfg)" ]',
				'[ "$old_stats" = "$(stat -c "%u:%g:%a" old old/config old/config/private.cfg)" ]',
				"cat new/config/private.cfg",
			].join("\n")
		);
		expect(result.split("\n")).toEqual(["2750", "2770", "600", "2770", "660", "770", "2750", "640", "new"]);
	});

	it("handles spaces, quotes and newlines in server and file names", () => {
		const result = shell(
			[
				'mv old "old server\'s"; mv new "new server\'s"',
				"name=$(printf 'private\\nfile.cfg')",
				'printf old > "old server\'s/$name"; printf new > "new server\'s/$name"',
				'chmod 600 "old server\'s/$name"',
				alignServerAccessScript("old server's", "new server's"),
				'stat -c %a "new server\'s/$name"',
			].join("\n")
		);
		expect(result).toBe("600");
	});

	it("does not inherit access through symlinks in the old server", () => {
		const result = shell(
			[
				"mkdir outside new/config new/new-dir",
				"chmod 700 outside; chmod 750 old",
				"printf old > outside/private.cfg; chmod 600 outside/private.cfg",
				"ln -s ../outside old/config; ln -s ../outside/private.cfg old/direct.cfg",
				"printf new > new/config/private.cfg; printf new > new/direct.cfg",
				"printf old > old/new-dir",
				"chmod 644 new/config/private.cfg new/direct.cfg",
				alignServerAccessScript("old", "new"),
				"stat -c %a new/config new/config/private.cfg new/direct.cfg new/new-dir outside/private.cfg",
			].join("\n")
		);
		expect(result.split("\n")).toEqual(["750", "640", "640", "750", "600"]);
	});

	it("preserves owner, group and mode on an atomic text replacement without changing content", () => {
		const result = shell(
			[
				"printf old > new/server.properties; printf merged > new/temporary",
				"chmod 640 new/server.properties",
				'if [ "$(id -u)" = 0 ]; then chown 1234:1235 new/server.properties; fi',
				'stats=$(stat -c "%u:%g:%a" new/server.properties)',
				preserveAccessScript("new/server.properties", "new/temporary"),
				"mv new/temporary new/server.properties",
				'[ "$stats" = "$(stat -c "%u:%g:%a" new/server.properties)" ]',
				"cat new/server.properties",
			].join("\n")
		);
		expect(result).toBe("merged");
	});
});
