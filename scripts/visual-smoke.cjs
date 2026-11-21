const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");

async function run() {
	await app.whenReady();
	const window = new BrowserWindow({
		width: 1180,
		height: 820,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "../out/preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	await window.loadFile(path.join(__dirname, "../out/renderer/index.html"));
	await window.webContents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
	const bodyText = await window.webContents.executeJavaScript("document.body.innerText");
	const expected = ["GTNH Server", "SSH connection", "Remote paths", "Carry over changes", "Migrate world", "Report"];
	if (expected.some((text) => !bodyText.includes(text))) {
		throw new Error(`Renderer did not mount correctly. Visible text: ${bodyText}`);
	}
	if (bodyText.includes("could not start")) {
		throw new Error("Renderer displayed the missing-preload fallback");
	}

	const image = await window.webContents.capturePage();
	const outputPath = path.join(__dirname, "../dist/ui-smoke.png");
	await writeFile(outputPath, image.toPNG());
	console.log(outputPath);
	await window.webContents.executeJavaScript("window.scrollTo(0, document.body.scrollHeight)");
	await new Promise((resolve) => setTimeout(resolve, 200));
	const bottomPath = path.join(__dirname, "../dist/ui-smoke-bottom.png");
	await writeFile(bottomPath, (await window.webContents.capturePage()).toPNG());
	console.log(bottomPath);

	// The Mods mode shares the rail and the SSH profile.
	await window.webContents.executeJavaScript(`(async () => {
    [...document.querySelectorAll(".modes button")].find((button) => button.textContent === "Mods").click();
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
	const modsText = await window.webContents.executeJavaScript("document.body.innerText");
	const modsExpected = ["Swap a mod", "Your build", "Replaces", "Prism instances", "Restore original"];
	if (modsExpected.some((text) => !modsText.includes(text))) {
		throw new Error(`Mods mode did not mount correctly. Visible text: ${modsText}`);
	}
	await new Promise((resolve) => setTimeout(resolve, 500));
	const modsPath = path.join(__dirname, "../dist/ui-smoke-mods.png");
	await writeFile(modsPath, (await window.webContents.capturePage()).toPNG());
	console.log(modsPath);
	await window.webContents.executeJavaScript("window.scrollTo(0, document.body.scrollHeight)");
	await new Promise((resolve) => setTimeout(resolve, 200));
	const modsBottomPath = path.join(__dirname, "../dist/ui-smoke-mods-bottom.png");
	await writeFile(modsBottomPath, (await window.webContents.capturePage()).toPNG());
	console.log(modsBottomPath);
	window.destroy();
	app.quit();
}

run().catch((error) => {
	console.error(error);
	app.exit(1);
});
