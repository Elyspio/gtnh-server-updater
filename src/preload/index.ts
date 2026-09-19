import { contextBridge, ipcRenderer } from "electron";
import type {
  DeploymentExecuteRequest,
  DeploymentPreflightRequest,
  DeploymentProgress,
  GtnhApi,
  SshConnectionInput,
} from "@shared/deployment.types";

const api: GtnhApi = {
  selectArchive: async () => await ipcRenderer.invoke("dialog:archive"),
  selectPrivateKey: async () => await ipcRenderer.invoke("dialog:private-key"),
  listRemoteDirectory: async (connection: SshConnectionInput, path: string) =>
    await ipcRenderer.invoke("remote:list", connection, path),
  preflight: async (request: DeploymentPreflightRequest) =>
    await ipcRenderer.invoke("deployment:preflight", request),
  execute: async (request: DeploymentExecuteRequest) =>
    await ipcRenderer.invoke("deployment:execute", request),
  onProgress: (listener: (progress: DeploymentProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: DeploymentProgress): void => listener(progress);
    ipcRenderer.on("deployment:progress", handler);
    return () => ipcRenderer.off("deployment:progress", handler);
  },
};

contextBridge.exposeInMainWorld("gtnh", api);
