import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CollateralItemEntity } from "@snooker/shared";
import { getDb } from "../client";
import { enqueueSyncWrite } from "./syncQueueRepo";
import { writeAuditLog } from "./auditLogRepo";

export function mapCollateralRow(row: any): CollateralItemEntity {
  return {
    id: row.id,
    gameId: row.game_id,
    customerId: row.customer_id,
    itemDescription: row.item_description,
    heldByUserId: row.held_by_user_id,
    heldAt: row.held_at,
    returned: !!row.returned,
    returnedAt: row.returned_at,
    returnedByUserId: row.returned_by_user_id,
  };
}

/** Low-level insert usable from inside another repo's own transaction (e.g. gamesRepo.endGame). */
export function insertCollateralItem(
  db: Database.Database,
  input: { gameId: number; customerId: number; itemDescription: string; heldByUserId: number }
): CollateralItemEntity {
  const localUuid = randomUUID();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO collateral_items (local_uuid, game_id, customer_id, item_description, held_by_user_id, held_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(localUuid, input.gameId, input.customerId, input.itemDescription.trim(), input.heldByUserId, now, now);
  const row = db.prepare(`SELECT * FROM collateral_items WHERE id = ?`).get(Number(result.lastInsertRowid));
  const entity = mapCollateralRow(row);
  enqueueSyncWrite(db, { localUuid, entityType: "collateral_items", operation: "insert", payload: entity });
  return entity;
}

/** Standalone IPC entry point (e.g. adding/editing collateral outside of the End Game & Checkout flow). */
export function addCollateral(input: {
  gameId: number;
  customerId: number;
  itemDescription: string;
  heldByUserId: number;
}): CollateralItemEntity {
  const db = getDb();
  const tx = db.transaction(() => {
    const entity = insertCollateralItem(db, input);
    writeAuditLog(db, {
      entityType: "collateral_items",
      entityId: entity.id,
      action: "create",
      afterValue: entity,
      performedById: input.heldByUserId,
    });
    return entity;
  });
  return tx();
}

/** Collateral item return tracking (decision #4). */
export function returnCollateral(input: { collateralId: number; returnedByUserId: number }): CollateralItemEntity {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const beforeRow = db.prepare(`SELECT * FROM collateral_items WHERE id = ?`).get(input.collateralId);
    if (!beforeRow) throw new Error(`Collateral item ${input.collateralId} not found`);
    const before = mapCollateralRow(beforeRow);
    if (before.returned) throw new Error("This item was already marked returned");

    db.prepare(
      `UPDATE collateral_items SET returned = 1, returned_at = ?, returned_by_user_id = ?, updated_at = ? WHERE id = ?`
    ).run(now, input.returnedByUserId, now, input.collateralId);

    const after = mapCollateralRow(db.prepare(`SELECT * FROM collateral_items WHERE id = ?`).get(input.collateralId));
    enqueueSyncWrite(db, { localUuid: randomUUID(), entityType: "collateral_items", operation: "update", payload: after });
    writeAuditLog(db, {
      entityType: "collateral_items",
      entityId: input.collateralId,
      action: "return_collateral",
      beforeValue: before,
      afterValue: after,
      performedById: input.returnedByUserId,
    });
    return after;
  });
  return tx();
}

export function listOpenCollateralForCustomer(customerId: number): CollateralItemEntity[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM collateral_items WHERE customer_id = ? AND returned = 0 ORDER BY held_at ASC`)
    .all(customerId);
  return (rows as any[]).map(mapCollateralRow);
}

export function countOpenCollateral(): number {
  const db = getDb();
  return (db.prepare(`SELECT COUNT(*) AS c FROM collateral_items WHERE returned = 0`).get() as { c: number }).c;
}
