/// <reference types="vite/client" />
import type { DesktopApi } from "../ipc/contract";

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export {};
