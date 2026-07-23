/**
 * Scheduled local backup (decision #14): copies the SQLite file to a
 * configurable folder (e.g. a second drive or USB stick) on an interval, so
 * a counter PC's disk failure doesn't lose unsynced data. Uses
 * better-sqlite3's built-in `.backup()` API rather than a raw file copy —
 * it safely snapshots a live database (including anything still sitting in
 * the WAL file) without requiring the app to pause writes.
 */
import path from "node:path";
import fs from "node:fs";
import { getDb } from "../db/client";
import { getSettings, updateSettings } from "../config";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check hourly whether a backup is due

export class BackupScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    void this.checkAndRunIfDue();
    this.timer = setInterval(() => void this.checkAndRunIfDue(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async checkAndRunIfDue(): Promise<void> {
    const settings = getSettings();
    if (!settings.backupFolderPath) return; // owner hasn't configured a backup folder yet

    const dueAt = settings.lastBackupAt
      ? new Date(settings.lastBackupAt).getTime() + settings.backupIntervalHours * 60 * 60 * 1000
      : 0;
    if (Date.now() < dueAt) return;

    await this.runBackupNow(settings.backupFolderPath);
  }

  async runBackupNow(destinationFolder: string): Promise<string> {
    fs.mkdirSync(destinationFolder, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destinationPath = path.join(destinationFolder, `snooker-counter-${stamp}.sqlite3`);

    await getDb().backup(destinationPath);
    updateSettings({ lastBackupAt: new Date().toISOString() });
    pruneOldBackups(destinationFolder);
    return destinationPath;
  }
}

/** Keeps the last 30 nightly backups so the folder doesn't grow unbounded. */
function pruneOldBackups(folder: string): void {
  try {
    const files = fs
      .readdirSync(folder)
      .filter((f) => f.startsWith("snooker-counter-") && f.endsWith(".sqlite3"))
      .sort();
    const excess = files.length - 30;
    for (let i = 0; i < excess; i++) {
      fs.unlinkSync(path.join(folder, files[i]!));
    }
  } catch {
    // Non-fatal — pruning is best-effort housekeeping, not correctness-critical.
  }
}
