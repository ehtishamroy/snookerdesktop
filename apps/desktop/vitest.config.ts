import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Separate from vite.config.ts (which wires up vite-plugin-electron, not
// needed/wanted for the test run) so `?raw` schema.sql imports still resolve
// under Vitest's own Vite pipeline without pulling in the Electron builder.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/main/**/*.test.ts"],
    setupFiles: ["./src/main/test-setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/renderer", import.meta.url)),
      "@ipc": fileURLToPath(new URL("./src/ipc", import.meta.url)),
    },
  },
});
