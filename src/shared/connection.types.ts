export type HostKeyCheck = { status: "known" } | { status: "unknown" | "mismatch"; host: string; port: number; keyType: string; fingerprint: string };

/** A process group started by the app that is still running on the server. */
export type RemoteOrphan = { id: string; pid: number; command: string };

export type ConnectionTestResult = {
	hostKey: HostKeyCheck;
	authenticated: boolean;
	orphans: RemoteOrphan[];
};

export type TrustHostRequest = { host: string; port: number; fingerprint: string };

export type SshProfile = {
	id: string;
	name: string;
	host: string;
	port: number;
	username: string;
	privateKeyPath: string;
	oldServerPath: string;
	newServerPath: string;
	hasStoredPassphrase: boolean;
};

export type SshProfileSaveRequest = Omit<SshProfile, "id" | "hasStoredPassphrase"> & {
	id?: string;
	passphrase?: string;
	rememberPassphrase: boolean;
};

export type SshProfileList = {
	profiles: SshProfile[];
	/** False when no real OS encryption is available (e.g. Linux basic_text backend). */
	canStorePassphrase: boolean;
};
