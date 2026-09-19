import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { electronApp, is } from "@electron-toolkit/utils";
import { join } from "node:path";
import type {
  DeploymentExecuteRequest,
  DeploymentPreflightRequest,
  DeploymentProgress,
  SshConnectionInput,
} from "@shared/deployment.types";
import { DeploymentService } from "./deployment/deployment.service";

let mainWindow: BrowserWindow | undefined;

const deploymentService = new DeploymentService((progress: DeploymentProgress) => {
  mainWindow?.webContents.send("deployment:progress", progress);
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: "#0b1118",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

ipcMain.handle("dialog:archive", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Select GTNH server archive",
    properties: ["openFile"],
    filters: [{ name: "ZIP archives", extensions: ["zip"] }],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("dialog:private-key", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Select SSH private key",
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("remote:list", async (_event, connection: SshConnectionInput, remotePath: string) =>
  await deploymentService.listRemoteDirectory(connection, remotePath));
ipcMain.handle("deployment:preflight", async (_event, request: DeploymentPreflightRequest) =>
  await deploymentService.preflight(request));
ipcMain.handle("deployment:execute", async (_event, request: DeploymentExecuteRequest) =>
  await deploymentService.execute(request));

app.whenReady().then(() => {
  electronApp.setAppUserModelId("dev.elyspio.gtnh-server-updater");
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
