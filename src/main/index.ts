import { app, BrowserWindow, dialog, safeStorage, shell, type IpcMainInvokeEvent } from "electron";
import { electronApp, is } from "@electron-toolkit/utils";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SshConnectionInput } from "@shared/deployment.types";
import type { EventChannel } from "@shared/ipc.channels";
import type { IpcEvents, IpcHandlers } from "@shared/ipc.contract";
import { DeploymentService } from "./deployment/deployment.service";
import { registerIpcHandlers } from "./ipc";
import { configureLogger, getLogDirectory, log } from "./logger";
import { MergeService } from "./merge/merge.service";
import { MigrationService } from "./migration/migration.service";
import { OperationRegistry } from "./operation-registry";
import { resolvePreloadPath } from "./preload-path";
import { ProfileStore } from "./profiles/profile-store";
import { listGtnhReleases, readLatestVersions } from "./releases/gtnh-releases";
import { killOrphan, testConnection, trustHost } from "./ssh/connection.service";
import { HostKeyStore, configureHostKeyStore } from "./ssh/host-key-store";
import { installUpdateNow, startAutoUpdate } from "./update";

let mainWindow: BrowserWindow | undefined;
let closingAfterCancel = false;
let profiles: ProfileStore;

const operations = new OperationRegistry();

function send<E extends EventChannel>(channel: E, payload: IpcEvents[E]): void {
  mainWindow?.webContents.send(channel, payload);
}

const deploymentService = new DeploymentService((progress) => send("deployment:progress", progress));
const mergeService = new MergeService((progress) => send("merge:progress", progress));
const migrationService = new MigrationService((progress) => send("migration:progress", progress));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: "#0b1118",
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(__dirname),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`Failed to load preload ${preloadPath}:`, error);
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("close", (event) => {
    if (closingAfterCancel || !operations.running) return;
    event.preventDefault();
    void confirmCloseDuringOperation();
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

async function confirmCloseDuringOperation(): Promise<void> {
  if (!mainWindow) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Keep running", "Cancel operation and quit"],
    defaultId: 0,
    cancelId: 0,
    message: "A remote operation is still running",
    detail: "Quitting cancels it. Partial files stay on the server and are listed in the log; app temporaries are removed.",
  });
  if (response !== 1) return;
  closingAfterCancel = true;
  operations.cancel();
  await operations.waitIdle(15_000);
  mainWindow?.close();
}

/** Only the main window's top frame may call the contract. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  return Boolean(mainWindow) && event.sender === mainWindow!.webContents && event.senderFrame === event.sender.mainFrame;
}

/** OS encryption only: Linux without a keyring falls back to basic_text, which is not accepted. */
function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

function withSecrets<T extends { connection: SshConnectionInput }>(request: T): T {
  return { ...request, connection: profiles.resolveConnection(request.connection) };
}

const handlers: IpcHandlers = {
  "dialog:archive": async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Select GTNH server archive",
      properties: ["openFile"],
      filters: [{ name: "ZIP archives", extensions: ["zip"] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  },
  "dialog:private-key": async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: "Select SSH private key", properties: ["openFile"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  },
  "profiles:list": () => profiles.list(),
  "profiles:save": async (request) => await profiles.save(request),
  "profiles:delete": async (id) => await profiles.delete(id),
  "ssh:test": async (connection) => await testConnection(profiles.resolveConnection(connection)),
  "ssh:trust-host": async (request) => await trustHost(request),
  "ssh:kill-orphan": async (connection, id, pid) => await killOrphan(profiles.resolveConnection(connection), id, pid),
  "releases:list": async () => await listGtnhReleases(),
  "releases:latest": async () => await readLatestVersions(),
  "remote:list": async (connection, remotePath) =>
    await deploymentService.listRemoteDirectory(profiles.resolveConnection(connection), remotePath),
  "remote:mkdir": async (connection, parentPath, name) =>
    await deploymentService.createRemoteDirectory(profiles.resolveConnection(connection), parentPath, name),
  "deployment:preflight": async (request) =>
    await operations.run("deployment preflight", async (signal) => await deploymentService.preflight(withSecrets(request), signal)),
  "deployment:execute": async (request) =>
    await operations.run("deployment", async (signal) => await deploymentService.execute(request, signal)),
  "merge:prepare": async (request) =>
    await operations.run("merge comparison", async (signal) => await mergeService.prepare(withSecrets(request), signal)),
  "merge:load-file": async (request) => await mergeService.loadFile(request),
  "merge:apply": async (request) =>
    await operations.run("merge application", async (signal) => await mergeService.apply(request, signal)),
  "merge:discard": async (operationId) => await mergeService.discard(operationId),
  "migration:prepare": async (request) =>
    await operations.run("world migration check", async (signal) => await migrationService.prepare(withSecrets(request), signal)),
  "migration:execute": async (request) =>
    await operations.run("world migration", async (signal) => await migrationService.execute(request, signal)),
  "operation:cancel": () => operations.cancel(),
  "app:open-logs": async () => {
    const directory = getLogDirectory();
    if (directory) await shell.openPath(directory);
  },
  "report:save": async (markdown, fileName) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Save migration report",
      defaultPath: fileName.replace(/[\\/:*?"<>|]/g, "_"),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, markdown, "utf8");
    log("info", `Report saved to ${result.filePath}`);
    return result.filePath;
  },
  "update:install": () => {
    if (operations.running) throw new Error("Wait for the remote operation to finish before restarting");
    installUpdateNow();
  },
};

registerIpcHandlers(handlers, isTrustedSender);

app.whenReady().then(() => {
  electronApp.setAppUserModelId("dev.elyspio.gtnh-server-updater");
  const userData = app.getPath("userData");
  configureLogger(join(userData, "logs"));
  configureHostKeyStore(new HostKeyStore(join(userData, "known_hosts")));
  profiles = new ProfileStore(join(userData, "profiles.json"), {
    available: secureStorageAvailable,
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  });
  log("info", `Application started ${app.getVersion()}`);
  createWindow();
  startAutoUpdate((status) => send("update:status", status));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let temporariesDiscarded = false;
app.on("before-quit", (event) => {
  if (temporariesDiscarded) return;
  event.preventDefault();
  temporariesDiscarded = true;
  const discard = Promise.allSettled([deploymentService.discardAll(), mergeService.discardAll()]);
  void Promise.race([discard, new Promise((resolve) => setTimeout(resolve, 10_000))]).finally(() => app.quit());
});
