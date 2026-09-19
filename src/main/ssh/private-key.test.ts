import { createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { utils } from "ssh2";
import { preparePrivateKey } from "./private-key";

describe("preparePrivateKey", () => {
  it("converts an unencrypted Ed25519 PPK v3 key to OpenSSH", () => {
    const fixture = createPpk3Fixture();
    const prepared = preparePrivateKey(Buffer.from(fixture.ppk));

    expect(prepared.passphrase).toBeUndefined();
    expect(prepared.privateKey.toString("utf8")).toContain("BEGIN OPENSSH PRIVATE KEY");
    const parsed = utils.parseKey(prepared.privateKey);
    expect(parsed).not.toBeInstanceOf(Error);
    expect(Array.isArray(parsed)).toBe(false);
    if (parsed instanceof Error || Array.isArray(parsed)) throw parsed;
    expect(parsed.getPublicSSH()).toEqual(fixture.publicBlob);
  });

  it("rejects a PPK whose integrity code was changed", () => {
    const fixture = createPpk3Fixture();
    const tampered = fixture.ppk.replace(/Private-MAC: [a-f\d]+/i, `Private-MAC: ${"0".repeat(64)}`);
    expect(() => preparePrivateKey(Buffer.from(tampered))).toThrow("failed its integrity check");
  });

  it("keeps OpenSSH keys unchanged", () => {
    const key = Buffer.from("-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n");
    expect(preparePrivateKey(key, "secret")).toEqual({ privateKey: key, passphrase: "secret" });
  });
});

function createPpk3Fixture(): { ppk: string; publicBlob: Buffer } {
  const pair = generateKeyPairSync("ed25519");
  const privateJwk = pair.privateKey.export({ format: "jwk" });
  const publicJwk = pair.publicKey.export({ format: "jwk" });
  const privateExponent = fromBase64Url(privateJwk.d!);
  const publicKey = fromBase64Url(publicJwk.x!);
  const algorithm = "ssh-ed25519";
  const encryption = "none";
  const comment = "test-key";
  const publicBlob = Buffer.concat([sshString(algorithm), sshString(publicKey)]);
  const privateBlob = sshString(asPositiveMpint(privateExponent));
  const macInput = Buffer.concat([
    sshString(algorithm),
    sshString(encryption),
    sshString(comment),
    sshString(publicBlob),
    sshString(privateBlob),
  ]);
  const mac = createHmac("sha256", Buffer.alloc(0)).update(macInput).digest("hex");
  return {
    publicBlob,
    ppk: [
      `PuTTY-User-Key-File-3: ${algorithm}`,
      `Encryption: ${encryption}`,
      `Comment: ${comment}`,
      "Public-Lines: 1",
      publicBlob.toString("base64"),
      "Private-Lines: 1",
      privateBlob.toString("base64"),
      `Private-MAC: ${mac}`,
      "",
    ].join("\n"),
  };
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function asPositiveMpint(value: Buffer): Buffer {
  return value[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
}

function sshString(value: string | Buffer): Buffer {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, data]);
}
