import type { ConnectionTestResult, TrustHostRequest } from "@shared/connection.types";
import type { SshConnectionInput } from "@shared/deployment.types";
import { getHostKeyStore } from "./host-key-store";
import { RemoteClient } from "./remote-client";
import { withClient } from "./remote-operations";

/**
 * Checks the host key first without authenticating; only a trusted host gets the key and
 * the passphrase. A successful login also reports leftover app processes on the server.
 */
export async function testConnection(connection: SshConnectionInput): Promise<ConnectionTestResult> {
	const probe = new RemoteClient(connection);
	try {
		await probe.connect({ hostKeyOnly: true });
	} catch (error) {
		if (!probe.hostKeyCheck) throw error;
	} finally {
		probe.close();
	}
	const hostKey = probe.hostKeyCheck!;
	if (hostKey.status !== "known") return { hostKey, authenticated: false, orphans: [] };

	const orphans = await withClient(connection, async (client) => await client.listOrphans());
	return { hostKey, authenticated: true, orphans };
}

export async function trustHost(request: TrustHostRequest): Promise<void> {
	await getHostKeyStore().trust(request.host, request.port, request.fingerprint);
}

export async function killOrphan(connection: SshConnectionInput, id: string, pid: number): Promise<void> {
	await withClient(connection, async (client) => await client.killOrphan(id, pid));
}
