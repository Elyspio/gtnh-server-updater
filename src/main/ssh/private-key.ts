import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type PreparedPrivateKey = {
  privateKey: Buffer;
  passphrase?: string;
};

export function preparePrivateKey(contents: Buffer, passphrase?: string): PreparedPrivateKey {
  const text = contents.toString("utf8");
  if (!text.startsWith("PuTTY-User-Key-File-3:")) {
    return { privateKey: contents, passphrase: passphrase || undefined };
  }

  return {
    privateKey: Buffer.from(convertUnencryptedEd25519Ppk3(text), "utf8"),
  };
}

function convertUnencryptedEd25519Ppk3(contents: string): string {
  const lines = contents.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  const algorithm = readHeader(lines[0], "PuTTY-User-Key-File-3");
  const encryption = readHeader(lines[1], "Encryption");
  const comment = readHeader(lines[2], "Comment");

  if (algorithm !== "ssh-ed25519") {
    throw new Error(`PuTTY PPK v3 key type '${algorithm}' is not supported. Export the key in OpenSSH format.`);
  }
  if (encryption !== "none") {
    throw new Error("Encrypted PuTTY PPK v3 keys are not supported. Export the key in OpenSSH format first.");
  }

  const publicSection = readBase64Section(lines, 3, "Public-Lines");
  const privateSection = readBase64Section(lines, publicSection.nextIndex, "Private-Lines");
  const expectedMacHex = readHeader(lines[privateSection.nextIndex], "Private-MAC");
  if (!/^[a-f\d]{64}$/i.test(expectedMacHex)) {
    throw new Error("The PuTTY PPK v3 integrity code is invalid.");
  }

  const macInput = Buffer.concat([
    sshString(algorithm),
    sshString(encryption),
    sshString(comment),
    sshString(publicSection.data),
    sshString(privateSection.data),
  ]);
  const actualMac = createHmac("sha256", Buffer.alloc(0)).update(macInput).digest();
  const expectedMac = Buffer.from(expectedMacHex, "hex");
  if (!timingSafeEqual(actualMac, expectedMac)) {
    throw new Error("The PuTTY PPK v3 key failed its integrity check.");
  }

  const publicReader = new SshReader(publicSection.data);
  if (publicReader.readString().toString("utf8") !== algorithm) {
    throw new Error("The PuTTY PPK v3 public key type does not match its header.");
  }
  const publicKey = publicReader.readString();
  publicReader.expectEnd("public key");
  if (publicKey.length !== 32) {
    throw new Error("The PuTTY PPK v3 Ed25519 public key has an invalid length.");
  }

  const privateReader = new SshReader(privateSection.data);
  const privateExponent = normalizeEd25519Exponent(privateReader.readString());
  privateReader.expectEnd("private key");
  verifyEd25519KeyPair(privateExponent, publicKey);

  const check = randomBytes(4);
  const privateBlockParts = [
    check,
    check,
    sshString(algorithm),
    sshString(publicKey),
    sshString(Buffer.concat([privateExponent, publicKey])),
    sshString(comment),
  ];
  const unpaddedLength = privateBlockParts.reduce((total, part) => total + part.length, 0);
  const paddingLength = 8 - (unpaddedLength % 8 || 8);
  const padding = Buffer.from(Array.from({ length: paddingLength || 8 }, (_, index) => index + 1));
  const privateBlock = Buffer.concat([...privateBlockParts, padding]);

  const openssh = Buffer.concat([
    Buffer.from("openssh-key-v1\0", "ascii"),
    sshString("none"),
    sshString("none"),
    sshString(Buffer.alloc(0)),
    uint32(1),
    sshString(publicSection.data),
    sshString(privateBlock),
  ]);
  const base64 = openssh.toString("base64").match(/.{1,70}/g)?.join("\n") ?? "";
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${base64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

function readHeader(line: string | undefined, name: string): string {
  const prefix = `${name}: `;
  if (!line?.startsWith(prefix)) throw new Error(`Invalid PuTTY PPK v3 file: missing ${name}.`);
  return line.slice(prefix.length);
}

function readBase64Section(lines: string[], index: number, name: string): { data: Buffer; nextIndex: number } {
  const rawCount = readHeader(lines[index], name);
  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) {
    throw new Error(`Invalid PuTTY PPK v3 file: invalid ${name}.`);
  }
  const encoded = lines.slice(index + 1, index + 1 + count).join("");
  if (!/^[A-Za-z\d+/]+={0,2}$/.test(encoded)) {
    throw new Error(`Invalid PuTTY PPK v3 file: malformed ${name}.`);
  }
  return { data: Buffer.from(encoded, "base64"), nextIndex: index + 1 + count };
}

function normalizeEd25519Exponent(value: Buffer): Buffer {
  const withoutSignByte = value.length === 33 && value[0] === 0 ? value.subarray(1) : value;
  if (withoutSignByte.length > 32) throw new Error("The PuTTY PPK v3 Ed25519 private key has an invalid length.");
  if (withoutSignByte.length === 32) return withoutSignByte;
  return Buffer.concat([Buffer.alloc(32 - withoutSignByte.length), withoutSignByte]);
}

function verifyEd25519KeyPair(privateExponent: Buffer, publicKey: Buffer): void {
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const privateKey = createPrivateKey({ key: Buffer.concat([pkcs8Prefix, privateExponent]), format: "der", type: "pkcs8" });
  const derived = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);
  if (!timingSafeEqual(derived, publicKey)) {
    throw new Error("The PuTTY PPK v3 public and private keys do not match.");
  }
}

function sshString(value: string | Buffer): Buffer {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return Buffer.concat([uint32(data.length), data]);
}

function uint32(value: number): Buffer {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32BE(value);
  return data;
}

class SshReader {
  private offset = 0;

  public constructor(private readonly data: Buffer) {}

  public readString(): Buffer {
    if (this.offset + 4 > this.data.length) throw new Error("The PuTTY PPK v3 key data is truncated.");
    const length = this.data.readUInt32BE(this.offset);
    this.offset += 4;
    if (this.offset + length > this.data.length) throw new Error("The PuTTY PPK v3 key data is truncated.");
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  public expectEnd(label: string): void {
    if (this.offset !== this.data.length) throw new Error(`The PuTTY PPK v3 ${label} contains unexpected data.`);
  }
}
