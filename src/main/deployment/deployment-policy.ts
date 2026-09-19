import path from "node:path";

const REQUIRED_ROOT_ENTRIES = ["config/", "mods/", "server.properties"] as const;

export function assertAbsoluteSafePath(value: string, label: string, allowRoot = false): void {
  if (!value.startsWith("/") || value.includes("\0")) {
    throw new Error(`${label} must be an absolute Linux path`);
  }
  if (!allowRoot && path.posix.normalize(value) === "/") {
    throw new Error(`${label} cannot be the filesystem root`);
  }
}

export function assertSeparateTrees(oldServerPath: string, destinationPath: string): void {
  const oldPath = trimSlash(path.posix.normalize(oldServerPath));
  const destination = trimSlash(path.posix.normalize(destinationPath));
  if (oldPath === destination) throw new Error("Old server and destination resolve to the same path");
  if (isWithin(oldPath, destination) || isWithin(destination, oldPath)) {
    throw new Error("Old server and destination cannot contain one another");
  }
}

export function inspectArchiveEntries(entries: string[], entryKinds: string[]): void {
  if (entries.length === 0) throw new Error("The ZIP archive is empty");
  if (entryKinds.length !== entries.length) {
    throw new Error("Unable to validate every ZIP entry type");
  }

  const unsafe = entries.filter((entry) => {
    if (!entry || entry.startsWith("/") || entry.includes("\\")) return true;
    const segments = entry.split("/");
    return segments.some((segment) => segment === "..");
  });
  if (unsafe.length > 0) {
    throw new Error(`Unsafe ZIP entries: ${unsafe.slice(0, 5).join(", ")}`);
  }

  const specialKinds = entryKinds.filter((kind) => kind !== "-" && kind !== "d");
  if (specialKinds.length > 0) throw new Error("The ZIP contains a symbolic link or special file");

  const normalized = new Set(entries.map((entry) => entry.replace(/^\.\//, "")));
  for (const required of REQUIRED_ROOT_ENTRIES) {
    const exists = required.endsWith("/")
      ? [...normalized].some((entry) => entry.startsWith(required))
      : normalized.has(required);
    if (!exists) throw new Error(`Required root entry is missing: ${required}`);
  }
}

export function calculateRequiredFreeBytes(uncompressedBytes: number): number {
  if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes < 0) {
    throw new Error("Invalid uncompressed archive size");
  }
  return uncompressedBytes + Math.ceil(uncompressedBytes / 10);
}

export function assertEnoughSpace(availableBytes: number, requiredBytes: number): void {
  if (availableBytes < requiredBytes) {
    throw new Error(`Insufficient disk space: ${requiredBytes} bytes required, ${availableBytes} available`);
  }
}

export function assertDeletionConfirmed(
  destinationNonEmpty: boolean,
  resolvedDestinationPath: string,
  confirmationPath?: string,
): void {
  if (destinationNonEmpty && confirmationPath !== resolvedDestinationPath) {
    throw new Error("Type the exact resolved destination path to authorize deletion");
  }
}

export function assertHttpsUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Archive URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Archive URL must be public HTTPS without embedded credentials");
  }
  return url;
}

function trimSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function isWithin(parent: string, child: string): boolean {
  return child.startsWith(`${parent}/`);
}
