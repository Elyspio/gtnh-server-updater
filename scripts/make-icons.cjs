/**
 * Renders src/renderer/public/icon.svg into the packaging icons, with Chromium as the
 * rasterizer: build/icon.png (1024 px, Linux and electron-builder) and build/icon.ico
 * (16 to 256 px PNG entries, Windows executable and installer).
 *
 *   pnpm icons
 */
const { app, BrowserWindow } = require("electron");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const root = path.join(__dirname, "..");

async function render(window, svg, size) {
	const dataUrl = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)};
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ${size};
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, ${size}, ${size});
    return canvas.toDataURL("image/png");
  })()`);
	return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** ICO container holding PNG images (supported since Windows Vista). */
function ico(images) {
	const header = Buffer.alloc(6 + images.length * 16);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = header.length;
	images.forEach(({ size, png }, index) => {
		const entry = 6 + index * 16;
		header.writeUInt8(size >= 256 ? 0 : size, entry);
		header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
		header.writeUInt16LE(1, entry + 4);
		header.writeUInt16LE(32, entry + 6);
		header.writeUInt32LE(png.length, entry + 8);
		header.writeUInt32LE(offset, entry + 12);
		offset += png.length;
	});
	return Buffer.concat([header, ...images.map((image) => image.png)]);
}

async function run() {
	await app.whenReady();
	const svg = await readFile(path.join(root, "src/renderer/public/icon.svg"), "utf8");
	const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
	await window.loadURL("about:blank");
	await mkdir(path.join(root, "build"), { recursive: true });

	await writeFile(path.join(root, "build/icon.png"), await render(window, svg, 1024));
	const images = [];
	for (const size of ICO_SIZES) images.push({ size, png: await render(window, svg, size) });
	await writeFile(path.join(root, "build/icon.ico"), ico(images));
	console.log("build/icon.png, build/icon.ico");
	window.destroy();
	app.quit();
}

run().catch((error) => {
	console.error(error);
	app.exit(1);
});
