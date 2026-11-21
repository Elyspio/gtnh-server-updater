import { open } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;
const MAX_CENTRAL_DIRECTORY = 64 * 1024 * 1024;

/**
 * Reads one entry of a ZIP file (a mod JAR) without loading the whole archive: the end
 * record, the central directory, then only the entry's data. Returns undefined when the
 * entry is absent. ZIP64 archives are refused; mod JARs never need it.
 */
export async function readZipEntry(file: string, entryName: string, maxBytes = 1024 * 1024): Promise<Buffer | undefined> {
	const handle = await open(file, "r");
	try {
		const { size } = await handle.stat();
		if (size < EOCD_MIN) throw new Error("Not a ZIP file");
		const tailLength = Math.min(size, EOCD_SEARCH);
		const tail = await read(handle, size - tailLength, tailLength);
		let eocd = -1;
		for (let offset = tail.length - EOCD_MIN; offset >= 0; offset--) {
			if (tail.readUInt32LE(offset) === EOCD_SIGNATURE) {
				eocd = offset;
				break;
			}
		}
		if (eocd < 0) throw new Error("Not a ZIP file");
		const entries = tail.readUInt16LE(eocd + 10);
		const directorySize = tail.readUInt32LE(eocd + 12);
		const directoryOffset = tail.readUInt32LE(eocd + 16);
		if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported");
		if (directorySize > MAX_CENTRAL_DIRECTORY || directoryOffset + directorySize > size) throw new Error("Invalid ZIP central directory");

		const directory = await read(handle, directoryOffset, directorySize);
		let cursor = 0;
		for (let index = 0; index < entries; index++) {
			if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error("Invalid ZIP central directory");
			const method = directory.readUInt16LE(cursor + 10);
			const compressedSize = directory.readUInt32LE(cursor + 20);
			const uncompressedSize = directory.readUInt32LE(cursor + 24);
			const nameLength = directory.readUInt16LE(cursor + 28);
			const extraLength = directory.readUInt16LE(cursor + 30);
			const commentLength = directory.readUInt16LE(cursor + 32);
			const localOffset = directory.readUInt32LE(cursor + 42);
			const name = directory.toString("utf8", cursor + 46, cursor + 46 + nameLength);
			cursor += 46 + nameLength + extraLength + commentLength;
			if (name !== entryName) continue;

			if (uncompressedSize > maxBytes) throw new Error(`${entryName} is larger than ${maxBytes} bytes`);
			const local = await read(handle, localOffset, 30);
			if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error("Invalid ZIP local header");
			const dataOffset = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
			if (dataOffset + compressedSize > size) throw new Error("Truncated ZIP entry");
			const data = await read(handle, dataOffset, compressedSize);
			if (method === 0) return data;
			if (method === 8) return inflateRawSync(data, { maxOutputLength: maxBytes });
			throw new Error(`Unsupported ZIP compression method ${method}`);
		}
		return undefined;
	} finally {
		await handle.close();
	}
}

async function read(handle: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Buffer> {
	const buffer = Buffer.alloc(length);
	const { bytesRead } = await handle.read(buffer, 0, length, position);
	if (bytesRead !== length) throw new Error("Truncated ZIP file");
	return buffer;
}
