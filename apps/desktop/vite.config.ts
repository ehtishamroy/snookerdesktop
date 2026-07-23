import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { fileURLToPath, URL } from "node:url";

// Single Vite config drives both halves of the app:
//  - the React renderer, rooted at the package root (index.html lives here,
//    with `<script src="/src/renderer/main.tsx">` pointing into src/renderer)
//  - the Electron main process + preload script, built/watched by
//    vite-plugin-electron so `pnpm dev` is one command that rebuilds and
//    reloads the main process on change and spawns/respawns the Electron
//    window automatically (this satisfies "dev runs vite + electron
//    concurrently" without a hand-rolled concurrently/wait-on script).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/renderer", import.meta.url)),
      "@ipc": fileURLToPath(new URL("./src/ipc", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: fileURLToPath(new URL("./src/main/index.ts", import.meta.url)),
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              // better-sqlite3 ships a native .node binding — never bundle it,
              // always require() it at runtime from node_modules.
              external: ["better-sqlite3", "electron"],
            },
          },
        },
      },
      preload: {
        input: fileURLToPath(new URL("./src/main/preload.ts", import.meta.url)),
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      // Renderer process side of vite-plugin-electron (polyfills Node built-ins
      // for renderer use) is intentionally omitted — the renderer never talks
      // to Node/SQLite directly, only through the typed window.api bridge.
    }),
  ],
});
