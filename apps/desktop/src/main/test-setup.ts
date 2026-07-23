import { vi } from "vitest";
import os from "node:os";
import path from "node:path";

// The main process imports `app` from "electron" for userData path resolution
// (see db/client.ts). Outside a real Electron runtime that module has no such
// API, so tests stub just enough of it — SNOOKER_DB_PATH (set per test file)
// takes priority anyway, this only covers the fallback branch being reached.
vi.mock("electron", () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), "snooker-desktop-test-userdata"),
  },
}));
