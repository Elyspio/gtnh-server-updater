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
  if (!bodyText.includes("GTNH Server Updater") || !bodyText.includes("1. Linux server")) {
    throw new Error(`Renderer did not mount correctly. Visible text: ${bodyText}`);
  }
  if (bodyText.includes("could not start")) {
    throw new Error("Renderer displayed the missing-preload fallback");
  }

  const image = await window.webContents.capturePage();
  const outputPath = path.join(__dirname, "../dist/ui-smoke.png");
  await writeFile(outputPath, image.toPNG());
  console.log(outputPath);
  window.destroy();
  app.quit();
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
