import { contextBridge, ipcRenderer } from "electron";
import { EVENT_CHANNELS, INVOKE_CHANNELS, type EventChannel, type InvokeChannel } from "@shared/ipc.channels";
import type { GtnhBridge } from "@shared/ipc.contract";

const invokeChannels = new Set<string>(INVOKE_CHANNELS);
const eventChannels = new Set<string>(EVENT_CHANNELS);

/** Forwards only contract channels; the main process validates every payload again. */
const bridge: GtnhBridge = {
  invoke: async (channel: InvokeChannel, ...args: unknown[]) => {
    if (!invokeChannels.has(channel)) throw new Error(`Unknown channel: ${String(channel)}`);
    return await ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: EventChannel, listener: (payload: unknown) => void) => {
    if (!eventChannels.has(channel)) throw new Error(`Unknown event: ${String(channel)}`);
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  },
} as GtnhBridge;

contextBridge.exposeInMainWorld("gtnh", bridge);
