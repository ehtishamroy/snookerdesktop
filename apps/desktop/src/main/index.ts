/**
 * Electron main process entry point: app lifecycle, the single BrowserWindow,
 * local SQLite bootstrap, and wiring up the three background services (sync
 * engine, idle-alert poller, backup scheduler) plus every IPC handler.
 */
import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { getDb, closeDb } from "./db/client";
import { registerIpcHandlers } from "./ipc/handlers";
import { SyncEngine } from "./sync/syncEngine";
import { IdleAlertPoller } from "./sync/idleAlertPoller";
import { BackupScheduler } from "./sync/backup";

// Vite-plugin-electron sets this env var while `pnpm dev` is running a live
// renderer dev server; in a packaged build it is undefined and we load the
// built dist/index.html instead.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: "Snooker Counter",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // External links (e.g. anything opened via target=_blank) open in the
  // user's normal browser, never inside the counter app's own window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  // Local SQLite must exist and be migrated before anything else touches it.
  getDb();

  mainWindow = createWindow();

  const syncEngine = new SyncEngine(() => mainWindow);
  const idleAlertPoller = new IdleAlertPoller(() => mainWindow);
  const backupScheduler = new BackupScheduler();

  registerIpcHandlers(syncEngine);
  syncEngine.start();
  idleAlertPoller.start();
  backupScheduler.start();

  // --- Auto-update slot -----------------------------------------------------
  // Not wired up in this build pass (out of scope for now — see
  // electron-builder.yml's header comment). When it's time to add it:
  //   import { autoUpdater } from "electron-updater";
  //   autoUpdater.checkForUpdatesAndNotify();
  // right here, once `mainWindow` exists, is the correct place for it.
  // ---------------------------------------------------------------------------

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  app.on("before-quit", () => {
    syncEngine.stop();
    idleAlertPoller.stop();
    backupScheduler.stop();
    closeDb();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
