import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_SERVICE_NAME, type SshProfile, type SshProfileList, type SshProfileSaveRequest } from "@shared/connection.types";
import type { SshConnectionInput } from "@shared/deployment.types";

/** OS-backed secret encryption (Electron safeStorage in the app). */
export type SecretCipher = {
	available(): boolean;
	encrypt(value: string): Buffer;
	decrypt(value: Buffer): string;
};

type StoredProfile = Omit<SshProfile, "hasStoredPassphrase"> & { encryptedPassphrase?: string };

/** Profiles live in a JSON file; a passphrase is kept only when the OS can really encrypt it. */
export class ProfileStore {
	public constructor(
		private readonly file: string,
		private readonly cipher: SecretCipher
	) {}

	public list(): SshProfileList {
		return {
			profiles: this.read().map(({ encryptedPassphrase, ...profile }) => ({ ...profile, hasStoredPassphrase: Boolean(encryptedPassphrase) })),
			canStorePassphrase: this.cipher.available(),
		};
	}

	public async save(request: SshProfileSaveRequest): Promise<SshProfile> {
		const name = request.name.trim();
		if (!name) throw new Error("Profile name is required");
		if (!request.host.trim() || !request.username.trim()) throw new Error("Host and username are required");
		if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65535) throw new Error("Invalid SSH port");

		const profiles = this.read();
		const existing = request.id ? profiles.find((profile) => profile.id === request.id) : undefined;
		let encryptedPassphrase: string | undefined;
		if (request.rememberPassphrase) {
			if (request.passphrase) {
				if (!this.cipher.available()) throw new Error("Secure passphrase storage is not available on this system");
				encryptedPassphrase = this.cipher.encrypt(request.passphrase).toString("base64");
			} else {
				encryptedPassphrase = existing?.encryptedPassphrase;
			}
		}

		const profile: StoredProfile = {
			id: existing?.id ?? randomUUID(),
			name,
			host: request.host.trim(),
			port: request.port,
			username: request.username.trim(),
			privateKeyPath: request.privateKeyPath.trim(),
			oldServerPath: request.oldServerPath.trim(),
			newServerPath: request.newServerPath.trim(),
			serviceName: request.serviceName.trim() || DEFAULT_SERVICE_NAME,
			encryptedPassphrase,
		};
		await this.write([...profiles.filter((entry) => entry.id !== profile.id), profile].sort((left, right) => left.name.localeCompare(right.name)));
		const { encryptedPassphrase: stored, ...visible } = profile;
		return { ...visible, hasStoredPassphrase: Boolean(stored) };
	}

	public async delete(id: string): Promise<void> {
		await this.write(this.read().filter((profile) => profile.id !== id));
	}

	/** Fills the stored passphrase in the main process; it is never sent to the renderer. */
	public resolveConnection(connection: SshConnectionInput): SshConnectionInput {
		if (connection.passphrase || !connection.profileId) return connection;
		const stored = this.read().find((profile) => profile.id === connection.profileId)?.encryptedPassphrase;
		if (!stored || !this.cipher.available()) return connection;
		return { ...connection, passphrase: this.cipher.decrypt(Buffer.from(stored, "base64")) };
	}

	private read(): StoredProfile[] {
		if (!existsSync(this.file)) return [];
		const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
		// Profiles saved before the Mods mode have no service: the GTNH default applies.
		return Array.isArray(parsed) ? (parsed as StoredProfile[]).map((profile) => ({ ...profile, serviceName: profile.serviceName || DEFAULT_SERVICE_NAME })) : [];
	}

	private async write(profiles: StoredProfile[]): Promise<void> {
		await mkdir(path.dirname(this.file), { recursive: true });
		const temporary = `${this.file}.tmp`;
		await writeFile(temporary, `${JSON.stringify(profiles, null, 2)}\n`, { mode: 0o600 });
		await rename(temporary, this.file);
	}
}
