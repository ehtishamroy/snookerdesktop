/**
 * Prepares a queued sync_queue row's JSON payload for POST /sync/push:
 *  1. Resolves every foreign key the payload carries (which were captured
 *     using this PC's LOCAL ids) into the cloud backend's own ids, using
 *     each referenced entity's `server_id` column (see db/entityMap.ts).
 *  2. For `update` operations on an entity type whose row was itself
 *     already synced, replaces the local `id` with the resolved server id
 *     so the backend knows which row to update. For `insert` operations
 *     the local `id` is stripped entirely — the backend assigns its own.
 *
 * Only `games` keeps a client-supplied stable identifier end-to-end
 * (`localUuid`, which IS a persisted, unique column on the server's `Game`
 * model per apps/server/prisma/schema.prisma) — every other entity type is
 * matched by the server id returned from ITS OWN prior insert push, so an
 * update to e.g. a payment or shift can only be pushed once that entity's
 * insert has itself been confirmed. `resolveForeignKeysForPush` returns
 * `{ defer: true }` when that hasn't happened yet, and the caller (see
 * syncEngine.ts) simply leaves the queue row for the next cycle rather than
 * treating it as an error — this is expected, not exceptional, since the
 * queue is processed in FIFO order and dependencies are normally only one
 * or two cycles behind.
 */
import type Database from "better-sqlite3";
import { resolveServerId } from "../db/entityMap";

export interface FkField {
  field: string;
  refType: string;
  nullable: boolean;
}

/** Also reused by sync/pullMerge.ts, in the opposite direction (server id -> local id). */
export const FK_FIELDS: Record<string, FkField[]> = {
  games: [
    { field: "tableId", refType: "tables", nullable: false },
    { field: "gameTypeId", refType: "game_types", nullable: false },
    { field: "loserCustomerId", refType: "customers", nullable: false },
    { field: "winnerCustomerId", refType: "customers", nullable: true },
    { field: "discountByUserId", refType: "users", nullable: true },
    { field: "createdByUserId", refType: "users", nullable: false },
    { field: "shiftId", refType: "shifts", nullable: false },
  ],
  payments: [
    { field: "customerId", refType: "customers", nullable: false },
    { field: "collectedByUserId", refType: "users", nullable: false },
    { field: "shiftId", refType: "shifts", nullable: false },
  ],
  collateral_items: [
    { field: "gameId", refType: "games", nullable: false },
    { field: "customerId", refType: "customers", nullable: false },
    { field: "heldByUserId", refType: "users", nullable: false },
    { field: "returnedByUserId", refType: "users", nullable: true },
  ],
  expenses: [
    { field: "recordedByUserId", refType: "users", nullable: false },
    { field: "shiftId", refType: "shifts", nullable: false },
  ],
  shifts: [
    { field: "userId", refType: "users", nullable: false },
    { field: "closedByUserId", refType: "users", nullable: true },
  ],
  pricing_rules: [
    { field: "gameTypeId", refType: "game_types", nullable: false },
    { field: "createdBy", refType: "users", nullable: false },
  ],
  audit_log: [{ field: "performedBy", refType: "users", nullable: false }],
  customers: [{ field: "mergedIntoCustomerId", refType: "customers", nullable: true }],
  users: [],
  tables: [],
};

export type ResolveResult = { defer: true } | { defer: false; payload: Record<string, unknown> };

export function resolveForeignKeysForPush(
  db: Database.Database,
  entityType: string,
  operation: "insert" | "update",
  rawPayload: Record<string, unknown>
): ResolveResult {
  const payload: Record<string, unknown> = { ...rawPayload };
  const fkFields = FK_FIELDS[entityType] ?? [];

  for (const fk of fkFields) {
    const localValue = payload[fk.field];
    if (localValue === null || localValue === undefined) {
      if (!fk.nullable) return { defer: true };
      continue;
    }
    const serverId = resolveServerId(db, fk.refType, localValue as number);
    if (serverId === null) return { defer: true };
    payload[fk.field] = serverId;
  }

  // Payments settle an array of local game ids — every one must itself have synced.
  if (entityType === "payments" && Array.isArray(payload.gameIds)) {
    const resolvedGameIds: number[] = [];
    for (const localGameId of payload.gameIds as number[]) {
      const serverGameId = resolveServerId(db, "games", localGameId);
      if (serverGameId === null) return { defer: true };
      resolvedGameIds.push(serverGameId);
    }
    payload.gameIds = resolvedGameIds;
  }

  if (entityType === "games") {
    // Games are matched server-side by their own stable localUuid column —
    // never send our local autoincrement id, it means nothing to the server.
    delete payload.id;
  } else if (operation === "insert") {
    delete payload.id;
  } else {
    // update: identify the row by its already-known server id, if any.
    const selfId = payload.id as number | undefined;
    if (selfId === undefined) return { defer: true };
    const selfServerId = resolveServerId(db, entityType, selfId);
    if (selfServerId === null) return { defer: true };
    payload.id = selfServerId;
  }

  return { defer: false, payload };
}
