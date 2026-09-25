import type { GtnhBridge } from "@shared/ipc.contract";

declare global {
  interface Window {
    gtnh: GtnhBridge;
  }
}

export {};
