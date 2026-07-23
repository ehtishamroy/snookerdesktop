/**
 * Background sync worker (spec §3.3). Polls connectivity on an interval;
 * when reachable, pushes queued local writes to POST /sync/push (idempotent
 * per operation via each queue row's own local_uuid) and pulls remote
 * changes via GET /sync/pull. The UI never blocks on any of this — every
 * write already completed locally and instantly before this engine ever
 * sees it (see db/repositories/*.ts, which enqueue synchronously inside the
 * same transaction as the write itself).
 */
import type { BrowserWindow } from "electron";
import { getDb } from "../db/client";
import { getPendingBatch, getPendingCount, markFailed, markSynced, type SyncQueueRow } from "../db/repositories/syncQueueRepo";
import { setServerId } from "../db/entityMap";
import { resolveForeignKeysForPush } from "./pushPayload";
import { applyPulledChanges, type PullResponse } from "./pullMerge";
import { getSettings } from "../config";
import { IPC_CHANNELS } from "../../ipc/contract";
import type { SyncState, SyncStatus } from "../../ipc/contract";

const POLL_INTERVAL_MS = 15_000;
const MAX_OPS_PER_CYCLE = 25;

interface PushResponseBody {
  results: { localUuid: string; status: "applied" | "duplicate" | "error"; serverId?: number; error?: string }[];
}

export class SyncEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private status: SyncStatus = { state: "offline", pendingCount: 0, lastSyncedAt: null, lastError: null };

  constructor(private getWindow: () => BrowserWindow | null) {}

  start(): void {
    if (this.timer) return;
    this.refreshPendingCount();
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  private refreshPendingCount(): void {
    this.status = { ...this.status, pendingCount: getPendingCount(getDb()) };
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.getWindow()?.webContents.send(IPC_CHANNELS.syncStatusChangedEvent, this.status);
  }

  /** Exposed for the "force sync now" UI action and for the polling loop itself. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.setStatus({ state: "syncing" });

    try {
      const { syncServerUrl } = getSettings();
      await this.pushPending(syncServerUrl);
      await this.pullChanges(syncServerUrl);
      this.refreshPendingCount();
      this.setStatus({ state: "synced", lastSyncedAt: new Date().toISOString(), lastError: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const offline = isLikelyOfflineError(error);
      this.refreshPendingCount();
      this.setStatus({ state: offline ? "offline" : "error", lastError: offline ? null : message });
    } finally {
      this.running = false;
    }
  }

  private async pushPending(baseUrl: string): Promise<void> {
    const db = getDb();
    let batch = getPendingBatch(db, MAX_OPS_PER_CYCLE);

    while (batch.length > 0) {
      let progressed = false;

      for (const row of batch) {
        const resolved = resolveForeignKeysForPush(db, row.entity_type, row.operation, JSON.parse(row.payload));
        if (resolved.defer) continue; // dependency not synced yet — try again next cycle

        // One operation per request keeps push order and FK-resolution
        // (which depends on the *previous* operation's server_id already
        // being known) trivially correct, at the cost of one extra HTTP
        // round-trip per row — an acceptable trade for a single club's
        // transaction volume.
        const response = await fetch(`${baseUrl}/sync/push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operations: [
              { localUuid: row.local_uuid, entityType: row.entity_type, operation: row.operation, payload: resolved.payload },
            ],
          }),
        });

        if (!response.ok) {
          markFailed(db, row.id, `HTTP ${response.status}`);
          throw new Error(`Sync push failed with HTTP ${response.status}`);
        }

        const body = (await response.json()) as PushResponseBody;
        const result = body.results.find((r) => r.localUuid === row.local_uuid);
        applyPushResult(db, row, result);
        progressed = true;
      }

      if (!progressed) break; // everything remaining is deferred on a dependency; stop this cycle
      batch = getPendingBatch(db, MAX_OPS_PER_CYCLE);
    }
  }

  private async pullChanges(baseUrl: string): Promise<void> {
    const db = getDb();
    const since = readLastPullTimestamp(db);

    const response = await fetch(`${baseUrl}/sync/pull?since=${encodeURIComponent(since)}`);
    if (!response.ok) throw new Error(`Sync pull failed with HTTP ${response.status}`);

    const pull = (await response.json()) as PullResponse;
    applyPulledChanges(db, pull);
    writeLastPullTimestamp(pull.serverTime ?? new Date().toISOString());
  }
}

function applyPushResult(db: ReturnType<typeof getDb>, row: SyncQueueRow, result: PushResponseBody["results"][number] | undefined): void {
  if (!result) {
    markFailed(db, row.id, "No result returned for this operation");
    return;
  }
  if (result.status === "error") {
    markFailed(db, row.id, result.error ?? "Unknown server error");
    return;
  }
  // 'applied' and 'duplicate' both mean the server now has this write —
  // duplicate happens on a retried push where the first attempt's response
  // never made it back to us, and per the idempotency contract it is safe
  // to simply mark our side synced too.
  if (result.serverId !== undefined) {
    setServerId(db, row.entity_type, extractLocalId(row), result.serverId);
  }
  markSynced(db, row.id);
}

function extractLocalId(row: SyncQueueRow): number {
  const payload = JSON.parse(row.payload) as { id?: number };
  return payload.id ?? -1;
}

function readLastPullTimestamp(db: ReturnType<typeof getDb>): string {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'lastPullAt'`).get() as { value: string } | undefined;
  return row?.value ?? new Date(0).toISOString();
}

function writeLastPullTimestamp(value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('lastPullAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(value);
}

function isLikelyOfflineError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    message.includes("timeout")
  );
}

export type { SyncStatus, SyncState };
