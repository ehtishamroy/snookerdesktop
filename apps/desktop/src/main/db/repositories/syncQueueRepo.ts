/**
 * The local-only sync_queue table. Every write-repo calls `enqueueSyncWrite`
 * from *inside* its own write transaction, so the queue entry and the actual
 * row change are always atomic — either both land or neither does (spec
 * §3.3.1/§11 Reliability: no data loss, and the UI never has to worry about a
 * write "succeeding" locally but silently never getting queued for sync).
 */
import type Database from "better-sqlite3";

export interface EnqueueSyncWriteInput {
  localUuid: string;
  entityType: string;
  operation: "insert" | "update";
  payload: unknown;
}

export function enqueueSyncWrite(db: Database.Database, input: EnqueueSyncWriteInput): void {
  db.prepare(
    `INSERT INTO sync_queue (local_uuid, entity_type, operation, payload, created_at, synced)
     VALUES (?, ?, ?, ?, ?, 0)`
  ).run(input.localUuid, input.entityType, input.operation, JSON.stringify(input.payload), new Date().toISOString());
}

export interface SyncQueueRow {
  id: number;
  local_uuid: string;
  entity_type: string;
  operation: "insert" | "update";
  payload: string;
  created_at: string;
  synced: number;
  synced_at: string | null;
  retry_count: number;
  last_error: string | null;
}

export function getPendingBatch(db: Database.Database, limit: number): SyncQueueRow[] {
  return db
    .prepare(`SELECT * FROM sync_queue WHERE synced = 0 ORDER BY id ASC LIMIT ?`)
    .all(limit) as SyncQueueRow[];
}

export function getPendingCount(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM sync_queue WHERE synced = 0`).get() as { c: number }).c;
}

export function markSynced(db: Database.Database, queueId: number): void {
  db.prepare(`UPDATE sync_queue SET synced = 1, synced_at = ? WHERE id = ?`).run(new Date().toISOString(), queueId);
}

export function markFailed(db: Database.Database, queueId: number, error: string): void {
  db.prepare(
    `UPDATE sync_queue SET retry_count = retry_count + 1, last_error = ? WHERE id = ?`
  ).run(error, queueId);
}

/** Skip past a permanently-duplicate op (server already applied this local_uuid) without treating it as an error. */
export function markDuplicateAsSynced(db: Database.Database, queueId: number): void {
  markSynced(db, queueId);
}
