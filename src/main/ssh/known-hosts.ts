import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type KnownHostEntry = {
  hostPatterns?: string[];
  hashed?: { salt: Buffer; hash: Buffer };
  keyType: string;
  keyBase64: string;
};

export type HostKeyStatus = "known" | "unknown" | "mismatch";

/** Host token as written in known_hosts: bare host on port 22, "[host]:port" otherwise. */
export function hostToken(host: string, port: number): string {
  const normalized = host.trim().toLowerCase();
  return port === 22 ? normalized : `[${normalized}]:${port}`;
}

/** Parses OpenSSH known_hosts lines; markers (@cert-authority, @revoked) are skipped. */
export function parseKnownHosts(content: string): KnownHostEntry[] {
  const entries: KnownHostEntry[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("@")) continue;
    const [hosts, keyType, keyBase64] = line.split(/\s+/);
    if (!hosts || !keyType || !keyBase64) continue;
    if (hosts.startsWith("|1|")) {
      const [, , salt, hash] = hosts.split("|");
      if (!salt || !hash) continue;
      entries.push({ hashed: { salt: Buffer.from(salt, "base64"), hash: Buffer.from(hash, "base64") }, keyType, keyBase64 });
    } else {
      entries.push({ hostPatterns: hosts.split(",").map((pattern) => pattern.toLowerCase()), keyType, keyBase64 });
    }
  }
  return entries;
}

export function entryMatchesHost(entry: KnownHostEntry, token: string): boolean {
  if (entry.hashed) {
    const digest = createHmac("sha1", entry.hashed.salt).update(token).digest();
    return digest.length === entry.hashed.hash.length && timingSafeEqual(digest, entry.hashed.hash);
  }
  let matched = false;
  for (const pattern of entry.hostPatterns ?? []) {
    const negated = pattern.startsWith("!");
    if (!wildcardMatch(negated ? pattern.slice(1) : pattern, token)) continue;
    if (negated) return false;
    matched = true;
  }
  return matched;
}

function wildcardMatch(pattern: string, value: string): boolean {
  const expression = pattern.split("").map((character) => {
    if (character === "*") return ".*";
    if (character === "?") return ".";
    return character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return new RegExp(`^${expression}$`).test(value);
}

/**
 * Same key recorded: known. Another key of the same type recorded: mismatch.
 * Otherwise the host (or this key type) is new and needs an explicit decision.
 */
export function checkHostKey(entries: KnownHostEntry[], token: string, keyType: string, keyBase64: string): HostKeyStatus {
  const hostEntries = entries.filter((entry) => entryMatchesHost(entry, token));
  if (hostEntries.some((entry) => entry.keyType === keyType && entry.keyBase64 === keyBase64)) return "known";
  if (hostEntries.some((entry) => entry.keyType === keyType)) return "mismatch";
  return "unknown";
}

/** Reads the algorithm name at the start of an SSH public key blob. */
export function keyTypeOf(keyBlob: Buffer): string {
  if (keyBlob.length < 4) throw new Error("Invalid host key");
  const length = keyBlob.readUInt32BE(0);
  if (length <= 0 || length > 64 || keyBlob.length < 4 + length) throw new Error("Invalid host key");
  return keyBlob.subarray(4, 4 + length).toString("ascii");
}

export function fingerprintOf(keyBlob: Buffer): string {
  return `SHA256:${createHash("sha256").update(keyBlob).digest("base64").replace(/=+$/, "")}`;
}

export function formatKnownHostLine(token: string, keyType: string, keyBase64: string): string {
  return `${token} ${keyType} ${keyBase64}\n`;
}
