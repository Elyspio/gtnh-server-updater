import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HostKeyCheck } from "@shared/connection.types";
import {
  checkHostKey,
  fingerprintOf,
  formatKnownHostLine,
  hostToken,
  keyTypeOf,
  parseKnownHosts,
} from "./known-hosts";

type ObservedKey = { keyType: string; keyBase64: string; fingerprint: string };

/**
 * Trusts keys from the user's OpenSSH known_hosts and from the app's own file.
 * Only a key observed during a connection attempt can be added, and only by fingerprint.
 */
export class HostKeyStore {
  private readonly observed = new Map<string, ObservedKey>();

  public constructor(
    private readonly appKnownHostsPath: string,
    private readonly userKnownHostsPath = path.join(os.homedir(), ".ssh", "known_hosts"),
  ) {}

  public check(host: string, port: number, keyBlob: Buffer): HostKeyCheck {
    const token = hostToken(host, port);
    const keyType = keyTypeOf(keyBlob);
    const keyBase64 = keyBlob.toString("base64");
    const fingerprint = fingerprintOf(keyBlob);
    this.observed.set(token, { keyType, keyBase64, fingerprint });
    const status = checkHostKey(this.readEntries(), token, keyType, keyBase64);
    return status === "known" ? { status } : { status, host, port, keyType, fingerprint };
  }

  public async trust(host: string, port: number, fingerprint: string): Promise<void> {
    const token = hostToken(host, port);
    const observed = this.observed.get(token);
    if (!observed || observed.fingerprint !== fingerprint) {
      throw new Error("This host key was not observed; test the connection again");
    }
    if (checkHostKey(this.readEntries(), token, observed.keyType, observed.keyBase64) === "mismatch") {
      throw new Error("A different key is already recorded for this host; the app does not override it");
    }
    await mkdir(path.dirname(this.appKnownHostsPath), { recursive: true });
    await appendFile(this.appKnownHostsPath, formatKnownHostLine(token, observed.keyType, observed.keyBase64));
  }

  private readEntries(): ReturnType<typeof parseKnownHosts> {
    return [this.userKnownHostsPath, this.appKnownHostsPath]
      .filter((file) => existsSync(file))
      .flatMap((file) => parseKnownHosts(readFileSync(file, "utf8")));
  }
}

let store: HostKeyStore | undefined;

export function configureHostKeyStore(value: HostKeyStore): void {
  store = value;
}

export function getHostKeyStore(): HostKeyStore {
  if (!store) throw new Error("Host key store is not configured");
  return store;
}
