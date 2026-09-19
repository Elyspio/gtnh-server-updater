import type { GtnhApi } from "@shared/deployment.types";

declare global {
  interface Window {
    gtnh: GtnhApi;
  }
}

export {};
