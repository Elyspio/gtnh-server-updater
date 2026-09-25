import { createHmac } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { checkHostKey, fingerprintOf, formatKnownHostLine, hostToken, keyTypeOf, parseKnownHosts } from "./known-hosts";

const KEY_A = "AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY_B = "AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function hashedEntry(token: string, key: string): string {
	const salt = Buffer.from("0123456789abcdef0123");
	const hash = createHmac("sha1", salt).update(token).digest();
	return `|1|${salt.toString("base64")}|${hash.toString("base64")} ssh-ed25519 ${key}`;
}

describe("known_hosts", () => {
	it("uses the bracketed form for non-default ports", () => {
		expect(hostToken("GTNH.example.test", 22)).toBe("gtnh.example.test");
		expect(hostToken("gtnh.example.test", 2222)).toBe("[gtnh.example.test]:2222");
	});

	it("recognizes plain, hashed and wildcard entries", () => {
		const entries = parseKnownHosts(
			[
				"# comment",
				`gtnh.example.test,10.0.0.5 ssh-ed25519 ${KEY_A}`,
				hashedEntry("[hashed.example.test]:2222", KEY_A),
				`*.lan,!secret.lan ssh-ed25519 ${KEY_A}`,
				`@cert-authority *.example.test ssh-ed25519 ${KEY_B}`,
			].join("\n")
		);
		expect(checkHostKey(entries, "gtnh.example.test", "ssh-ed25519", KEY_A)).toBe("known");
		expect(checkHostKey(entries, "10.0.0.5", "ssh-ed25519", KEY_A)).toBe("known");
		expect(checkHostKey(entries, "[hashed.example.test]:2222", "ssh-ed25519", KEY_A)).toBe("known");
		expect(checkHostKey(entries, "server.lan", "ssh-ed25519", KEY_A)).toBe("known");
		expect(checkHostKey(entries, "secret.lan", "ssh-ed25519", KEY_A)).toBe("unknown");
	});

	it("reports a changed key of the same type as a mismatch", () => {
		const entries = parseKnownHosts(`gtnh.example.test ssh-ed25519 ${KEY_A}`);
		expect(checkHostKey(entries, "gtnh.example.test", "ssh-ed25519", KEY_B)).toBe("mismatch");
		expect(checkHostKey(entries, "gtnh.example.test", "ssh-rsa", KEY_B)).toBe("unknown");
		expect(checkHostKey(entries, "other.example.test", "ssh-ed25519", KEY_A)).toBe("unknown");
	});

	it("reads key type and SHA256 fingerprint from the key blob", () => {
		const blob = Buffer.from(KEY_A, "base64");
		expect(keyTypeOf(blob)).toBe("ssh-ed25519");
		expect(fingerprintOf(blob)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
		expect(formatKnownHostLine("[h]:2222", "ssh-ed25519", KEY_A)).toBe(`[h]:2222 ssh-ed25519 ${KEY_A}\n`);
	});
});
