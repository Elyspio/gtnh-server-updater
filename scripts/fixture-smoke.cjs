/** Screenshots a renderer fixture page: electron scripts/fixture-smoke.cjs merge-list */
const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");

const fixture = process.argv[2] ?? "merge-list";

async function run() {
	await app.whenReady();
	const window = new BrowserWindow({ width: 1400, height: 950, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
	const [name, ...flags] = fixture.split("&");
	await window.loadFile(path.join(__dirname, "../out/renderer/index.html"), {
		query: Object.fromEntries([["fixture", name], ...flags.map((flag) => flag.split("="))]),
	});
	await window.webContents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    await new Promise((resolve) => setTimeout(resolve, 1500));
  })()`);
	// Optional third argument: text of a button to click before the screenshot.
	const clickText = process.argv[3] === "open-picker" ? "Choose a build" : process.argv[3];
	if (clickText) {
		await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes(${JSON.stringify(clickText)}))?.click()`);
		await new Promise((resolve) => setTimeout(resolve, 900));
	}
	const visible = await window.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll(".merge-row")];
    const readable = rows.filter((row) => row.innerText.trim().length > 0);
    return { rows: rows.length, readable: readable.length, firstRow: rows[0]?.innerText, lastRow: rows.at(-1)?.innerText, bodyHeight: document.body.scrollHeight };
  })()`);
	console.log(JSON.stringify(visible));
	const output = path.join(__dirname, `../dist/fixture-${fixture.replace(/[^a-z0-9-]+/gi, "-")}.png`);
	await writeFile(output, (await window.webContents.capturePage()).toPNG());
	console.log(output);
	app.exit(0);
}

run().catch((error) => {
	console.error(error);
	app.exit(1);
});
