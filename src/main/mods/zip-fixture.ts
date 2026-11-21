import { crc32, deflateRawSync } from "node:zlib";

/** Builds a small ZIP in memory for tests: deflated entries, no ZIP64. */
export function makeZip(entries: Record<string, string | Buffer>): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, value] of Object.entries(entries)) {
		const content = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
		const compressed = deflateRawSync(content);
		const nameBytes = Buffer.from(name, "utf8");
		const checksum = crc32(content);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(content.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		locals.push(local, nameBytes, compressed);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(content.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBytes);
		offset += local.length + nameBytes.length + compressed.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 8);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}

export function modInfoJson(modId: string, version: string, name = modId): string {
	return JSON.stringify({ modListVersion: 2, modList: [{ modid: modId, name, version }] });
}
