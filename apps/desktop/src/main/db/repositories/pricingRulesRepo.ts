import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { PricingRuleEntity, TableType } from "@snooker/shared";
import type { PricingBlock } from "@snooker/shared";
import { getDb } from "../client";
import { enqueueSyncWrite } from "./syncQueueRepo";
import { writeAuditLog } from "./auditLogRepo";

function mapRow(row: any): PricingRuleEntity {
  return {
    id: row.id,
    tableType: row.table_type,
    gameTypeId: row.game_type_id,
    price: row.price,
    durationMinutes: row.duration_minutes,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdBy: row.created_by_id,
  };
}

export function getActivePricingRules(tableType?: TableType): PricingRuleEntity[] {
  const db = getDb();
  const rows = tableType
    ? db.prepare(`SELECT * FROM pricing_rules WHERE table_type = ? AND effective_to IS NULL`).all(tableType)
    : db.prepare(`SELECT * FROM pricing_rules WHERE effective_to IS NULL`).all();
  return (rows as any[]).map(mapRow);
}

export function getPricingRuleHistory(filter: { tableType?: TableType; gameTypeId?: number }): PricingRuleEntity[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.tableType) {
    clauses.push("table_type = ?");
    params.push(filter.tableType);
  }
  if (filter.gameTypeId !== undefined) {
    clauses.push("game_type_id = ?");
    params.push(filter.gameTypeId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM pricing_rules ${where} ORDER BY effective_from DESC`)
    .all(...params);
  return (rows as any[]).map(mapRow);
}

/**
 * Resolves the exact billing block for a game at the moment it starts, per
 * decision #2: "the rule whose effective_from <= start_time <
 * COALESCE(effective_to, 'infinity')". Old games always keep reflecting the
 * price active when they were played even if the owner changes prices later,
 * because we snapshot priceOriginal/priceFinal onto the game row itself —
 * this lookup is only used to resolve the block at start/end time.
 */
export function resolvePricingBlock(
  db: Database.Database,
  tableType: TableType,
  gameTypeId: number,
  atTime: string
): PricingBlock {
  const row = db
    .prepare(
      `SELECT * FROM pricing_rules
       WHERE table_type = ? AND game_type_id = ?
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY effective_from DESC LIMIT 1`
    )
    .get(tableType, gameTypeId, atTime, atTime) as any;
  if (!row) {
    throw new Error(`No active pricing rule for tableType=${tableType} gameTypeId=${gameTypeId} at ${atTime}`);
  }
  return { blockPrice: row.price, blockDurationMinutes: row.duration_minutes };
}

/**
 * Owner-only: creates a new versioned pricing rule and closes the previous
 * active rule for the same (tableType, gameTypeId), mirroring exactly what
 * the server does for POST /pricing-rules (see docs/API_CONTRACT.md) so
 * desktop-originated price changes behave identically to dashboard-originated
 * ones once synced.
 */
export function createPricingRule(input: {
  tableType: TableType;
  gameTypeId: number;
  price: number;
  durationMinutes: number;
  createdByUserId: number;
}): PricingRuleEntity {
  const db = getDb();
  const now = new Date().toISOString();
  const localUuid = randomUUID();

  const tx = db.transaction(() => {
    const previous = db
      .prepare(`SELECT * FROM pricing_rules WHERE table_type = ? AND game_type_id = ? AND effective_to IS NULL`)
      .get(input.tableType, input.gameTypeId) as any;

    if (previous) {
      db.prepare(`UPDATE pricing_rules SET effective_to = ?, updated_at = ? WHERE id = ?`).run(now, now, previous.id);
      const closedEntity = mapRow({ ...previous, effective_to: now });
      enqueueSyncWrite(db, { localUuid: randomUUID(), entityType: "pricing_rules", operation: "update", payload: closedEntity });
    }

    const result = db
      .prepare(
        `INSERT INTO pricing_rules (local_uuid, table_type, game_type_id, price, duration_minutes, effective_from, effective_to, created_by_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(localUuid, input.tableType, input.gameTypeId, input.price, input.durationMinutes, now, input.createdByUserId, now);

    const row = db.prepare(`SELECT * FROM pricing_rules WHERE id = ?`).get(Number(result.lastInsertRowid));
    const entity = mapRow(row);
    enqueueSyncWrite(db, { localUuid, entityType: "pricing_rules", operation: "insert", payload: entity });
    writeAuditLog(db, {
      entityType: "pricing_rules",
      entityId: entity.id,
      action: "create",
      beforeValue: previous ? mapRow(previous) : null,
      afterValue: entity,
      performedById: input.createdByUserId,
    });
    return entity;
  });

  return tx();
}
