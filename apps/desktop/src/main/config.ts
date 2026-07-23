/**
 * App-level configuration persisted in the local `app_settings` key/value
 * table: the cloud sync server URL and the nightly local-backup folder path
 * (decision #14), plus bookkeeping (backup interval, last backup time).
 */
import { getDb } from "./db/client";
import type { AppSettings } from "../ipc/contract";

const DEFAULTS: AppSettings = {
  syncServerUrl: "http://localhost:4000/api",
  backupFolderPath: null,
  backupIntervalHours: 24,
  lastBackupAt: null,
};

const KEYS: (keyof AppSettings)[] = ["syncServerUrl", "backupFolderPath", "backupIntervalHours", "lastBackupAt"];

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM app_settings WHERE key IN (${KEYS.map(() => "?").join(",")})`).all(...KEYS) as {
    key: string;
    value: string | null;
  }[];
  const stored: Record<string, string | null> = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    syncServerUrl: stored.syncServerUrl ?? DEFAULTS.syncServerUrl,
    backupFolderPath: stored.backupFolderPath ?? DEFAULTS.backupFolderPath,
    backupIntervalHours: stored.backupIntervalHours ? Number(stored.backupIntervalHours) : DEFAULTS.backupIntervalHours,
    lastBackupAt: stored.lastBackupAt ?? DEFAULTS.lastBackupAt,
  };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      upsert.run(key, value === null ? null : String(value));
    }
  });
  tx();
  return getSettings();
}
