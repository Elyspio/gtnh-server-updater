import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ProfileStore, type SecretCipher } from "./profile-store";

function cipher(available: boolean): SecretCipher {
	return {
		available: () => available,
		encrypt: (value) => Buffer.from(`enc:${value}`),
		decrypt: (value) => value.toString().replace(/^enc:/, ""),
	};
}

const PROFILE = {
	name: "Home server",
	host: "gtnh.example.test",
	port: 22,
	username: "minecraft",
	privateKeyPath: "C:/keys/id_ed25519",
	oldServerPath: "/srv/gtnh-old",
	newServerPath: "/srv/gtnh-new",
};

function storeFile(): string {
	return path.join(mkdtempSync(path.join(os.tmpdir(), "gtnh-profiles-")), "profiles.json");
}

describe("profile store", () => {
	it("keeps the passphrase encrypted and resolves it only in the main process", async () => {
		const file = storeFile();
		const store = new ProfileStore(file, cipher(true));
		const saved = await store.save({ ...PROFILE, passphrase: "secret", rememberPassphrase: true });

		expect(saved.hasStoredPassphrase).toBe(true);
		expect(JSON.stringify(store.list())).not.toContain("secret");
		expect(readFileSync(file, "utf8")).not.toContain("secret");
		expect(store.resolveConnection({ ...PROFILE, profileId: saved.id }).passphrase).toBe("secret");
		expect(store.resolveConnection({ ...PROFILE, profileId: saved.id, passphrase: "typed" }).passphrase).toBe("typed");
	});

	it("refuses to store a passphrase without real encryption", async () => {
		const store = new ProfileStore(storeFile(), cipher(false));
		await expect(store.save({ ...PROFILE, passphrase: "secret", rememberPassphrase: true })).rejects.toThrow("not available");
		const saved = await store.save({ ...PROFILE, passphrase: "secret", rememberPassphrase: false });
		expect(saved.hasStoredPassphrase).toBe(false);
		expect(store.list().canStorePassphrase).toBe(false);
	});

	it("updates, keeps an existing passphrase and deletes profiles", async () => {
		const store = new ProfileStore(storeFile(), cipher(true));
		const saved = await store.save({ ...PROFILE, passphrase: "secret", rememberPassphrase: true });
		const updated = await store.save({ ...PROFILE, id: saved.id, name: "Renamed", rememberPassphrase: true });
		expect(updated).toMatchObject({ id: saved.id, name: "Renamed", hasStoredPassphrase: true });
		expect(store.list().profiles).toHaveLength(1);

		const forgotten = await store.save({ ...PROFILE, id: saved.id, rememberPassphrase: false });
		expect(forgotten.hasStoredPassphrase).toBe(false);
		await store.delete(saved.id);
		expect(store.list().profiles).toEqual([]);
	});
});
