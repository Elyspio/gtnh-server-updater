import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Server, utils } from "ssh2";
import type { SshConnectionInput } from "@shared/deployment.types";
import { HostKeyStore, configureHostKeyStore } from "./host-key-store";
import { RemoteClient } from "./remote-client";
import { testConnection } from "./connection.service";

const directory = mkdtempSync(path.join(os.tmpdir(), "gtnh-ssh-"));
const hostKey = utils.generateKeyPairSync("ed25519");
const clientKey = utils.generateKeyPairSync("ed25519");
const otherClientKey = utils.generateKeyPairSync("ed25519");
const allowedPublicKey = utils.parseKey(clientKey.public);
if (allowedPublicKey instanceof Error) throw allowedPublicKey;

let server: Server;
let port = 0;

function connection(keyFile: string): SshConnectionInput {
	return { host: "127.0.0.1", port, username: "gtnh", privateKeyPath: keyFile };
}

beforeAll(async () => {
	writeFileSync(path.join(directory, "id_ok"), clientKey.private);
	writeFileSync(path.join(directory, "id_rejected"), otherClientKey.private);
	server = new Server({ hostKeys: [hostKey.private] }, (client) => {
		client.on("authentication", (context) => {
			const accepted = context.method === "publickey" && context.key.algo === allowedPublicKey.type && context.key.data.equals(allowedPublicKey.getPublicSSH());
			if (accepted) context.accept();
			else context.reject(["publickey"]);
		});
		client.on("error", () => undefined);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(() => {
	server.close();
});

describe("SSH host trust and authentication", () => {
	it("asks for trust on first use, then connects once the fingerprint is accepted", async () => {
		const store = new HostKeyStore(path.join(directory, "app_known_hosts"), path.join(directory, "missing_user_known_hosts"));
		configureHostKeyStore(store);
		const target = connection(path.join(directory, "id_ok"));

		const first = await testConnection(target);
		expect(first.hostKey.status).toBe("unknown");
		expect(first.authenticated).toBe(false);

		const direct = new RemoteClient(target);
		await expect(direct.connect()).rejects.toThrow("not trusted yet");

		if (first.hostKey.status === "known") throw new Error("unexpected");
		await store.trust(first.hostKey.host, first.hostKey.port, first.hostKey.fingerprint);
		const trusted = new RemoteClient(target);
		await expect(trusted.connect()).resolves.toBeUndefined();
		trusted.close();
	});

	it("refuses a host whose recorded key differs", async () => {
		const userKnownHosts = path.join(directory, "user_known_hosts");
		const otherHost = utils.generateKeyPairSync("ed25519").public.split(" ")[1];
		writeFileSync(userKnownHosts, `[127.0.0.1]:${port} ssh-ed25519 ${otherHost}\n`);
		configureHostKeyStore(new HostKeyStore(path.join(directory, "empty_app_known_hosts"), userKnownHosts));

		const result = await testConnection(connection(path.join(directory, "id_ok")));
		expect(result.hostKey.status).toBe("mismatch");
		await expect(new RemoteClient(connection(path.join(directory, "id_ok"))).connect()).rejects.toThrow("identity changed");
	});

	it("reports a rejected key as an authentication failure", async () => {
		const store = new HostKeyStore(path.join(directory, "auth_known_hosts"), path.join(directory, "missing_user_known_hosts"));
		configureHostKeyStore(store);
		const probe = await testConnection(connection(path.join(directory, "id_rejected")));
		if (probe.hostKey.status === "known") throw new Error("unexpected");
		await store.trust(probe.hostKey.host, probe.hostKey.port, probe.hostKey.fingerprint);

		await expect(new RemoteClient(connection(path.join(directory, "id_rejected"))).connect()).rejects.toThrow("Authentication failed");
	});

	it("only trusts a key that was observed during a connection", async () => {
		const store = new HostKeyStore(path.join(directory, "observed_known_hosts"), path.join(directory, "missing_user_known_hosts"));
		await expect(store.trust("127.0.0.1", port, "SHA256:forged")).rejects.toThrow("not observed");
	});
});
