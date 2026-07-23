import { randomUUID } from "node:crypto";
import type { CustomerEntity } from "@snooker/shared";
import { buildCustomerLedger, type LedgerGame } from "@snooker/shared";
import { getDb } from "../client";
import { enqueueSyncWrite } from "./syncQueueRepo";
import { writeAuditLog } from "./auditLogRepo";
import type { CustomerLedgerView, CustomerSuggestion, LoanLedgerRow } from "../../../ipc/contract";

function mapRow(row: any): CustomerEntity {
  return {
    id: row.id,
    displayName: row.display_name,
    isTemporary: !!row.is_temporary,
    nishaniDescription: row.nishani_description,
    mergedIntoCustomerId: row.merged_into_customer_id,
    phone: row.phone,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Unsettled = concluded round whose payment was never fully collected. */
const UNSETTLED_STATUSES = ["pending", "loan", "collateral", "tricked"] as const;

/**
 * Autosuggest search for the Register Panel's player/winner fields.
 * Decision #17: nishani ("Don't know the name") records and anything already
 * merged into another profile must NEVER surface here, regardless of sync
 * state — enforced with a hard filter, not left to the server.
 */
export function searchCustomers(query: string): CustomerSuggestion[] {
  const db = getDb();
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const rows = db
    .prepare(
      `SELECT c.*,
              COALESCE((
                SELECT SUM(g.price_final) FROM games g
                WHERE g.loser_customer_id = c.id AND g.reversed = 0 AND g.end_time IS NOT NULL
                  AND g.payment_status IN ('pending','loan','collateral','tricked')
              ), 0) AS owed_amount
       FROM customers c
       WHERE c.is_temporary = 0
         AND c.merged_into_customer_id IS NULL
         AND c.display_name LIKE ? COLLATE NOCASE
       ORDER BY c.display_name ASC
       LIMIT 20`
    )
    .all(`%${trimmed}%`) as any[];

  return rows.map((row) => ({ ...mapRow(row), owedAmount: row.owed_amount }));
}

export function getCustomerById(customerId: number): CustomerEntity {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(customerId);
  if (!row) throw new Error(`Customer ${customerId} not found`);
  return mapRow(row);
}

export function createCustomer(input: { displayName: string; phone?: string; notes?: string }): CustomerEntity {
  const db = getDb();
  const localUuid = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO customers (local_uuid, display_name, is_temporary, phone, notes, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?)`
      )
      .run(localUuid, input.displayName.trim(), input.phone ?? null, input.notes ?? null, now, now);
    const row = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(Number(result.lastInsertRowid));
    const entity = mapRow(row);
    enqueueSyncWrite(db, { localUuid, entityType: "customers", operation: "insert", payload: entity });
    return entity;
  });
  return tx();
}

/** "Don't know the name" toggle — stored as its own lightweight customer-like record. */
export function createNishaniCustomer(input: { nishaniDescription: string }): CustomerEntity {
  const db = getDb();
  const localUuid = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO customers (local_uuid, display_name, is_temporary, nishani_description, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?)`
      )
      .run(localUuid, input.nishaniDescription.trim(), input.nishaniDescription.trim(), now, now);
    const row = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(Number(result.lastInsertRowid));
    const entity = mapRow(row);
    enqueueSyncWrite(db, { localUuid, entityType: "customers", operation: "insert", payload: entity });
    return entity;
  });
  return tx();
}

/** Owner/manager only (enforced by the IPC layer). Preserves full history — never duplicates. */
export function mergeCustomers(input: { fromCustomerId: number; intoCustomerId: number; performedByUserId: number }): void {
  if (input.fromCustomerId === input.intoCustomerId) {
    throw new Error("Cannot merge a customer into itself");
  }
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const from = getCustomerById(input.fromCustomerId);
    const into = getCustomerById(input.intoCustomerId);
    if (into.mergedIntoCustomerId) {
      throw new Error("Cannot merge into a customer that was itself already merged elsewhere");
    }

    db.prepare(`UPDATE games SET loser_customer_id = ?, updated_at = ? WHERE loser_customer_id = ?`).run(
      input.intoCustomerId,
      now,
      input.fromCustomerId
    );
    db.prepare(`UPDATE games SET winner_customer_id = ?, updated_at = ? WHERE winner_customer_id = ?`).run(
      input.intoCustomerId,
      now,
      input.fromCustomerId
    );
    db.prepare(`UPDATE payments SET customer_id = ? WHERE customer_id = ?`).run(input.intoCustomerId, input.fromCustomerId);
    db.prepare(`UPDATE collateral_items SET customer_id = ? WHERE customer_id = ?`).run(
      input.intoCustomerId,
      input.fromCustomerId
    );
    db.prepare(`UPDATE customers SET merged_into_customer_id = ?, updated_at = ? WHERE id = ?`).run(
      input.intoCustomerId,
      now,
      input.fromCustomerId
    );

    const after = getCustomerById(input.fromCustomerId);
    enqueueSyncWrite(db, { localUuid: randomUUID(), entityType: "customers", operation: "update", payload: after });

    writeAuditLog(db, {
      entityType: "customers",
      entityId: input.fromCustomerId,
      action: "merge",
      beforeValue: from,
      afterValue: { ...after, mergedIntoDisplayName: into.displayName },
      performedById: input.performedByUserId,
    });
  });
  tx();
}

export function getCustomerLedger(customerId: number): CustomerLedgerView {
  const db = getDb();
  const customer = getCustomerById(customerId);

  const rows = db
    .prepare(
      `SELECT g.id AS game_id, t.table_number, t.label AS table_label, gt.name AS game_type_name,
              g.start_time, g.end_time, g.duration_billed_minutes, g.price_final, g.payment_status
       FROM games g
       JOIN tables t ON t.id = g.table_id
       JOIN game_types gt ON gt.id = g.game_type_id
       WHERE g.loser_customer_id = ? AND g.reversed = 0 AND g.end_time IS NOT NULL
         AND g.payment_status IN ('pending','loan','collateral','tricked')
       ORDER BY g.start_time ASC`
    )
    .all(customerId) as any[];

  const ledgerGames: LedgerGame[] = rows.map((r) => ({
    gameId: r.game_id,
    tableNumber: r.table_number,
    gameTypeName: r.game_type_name,
    startTime: new Date(r.start_time),
    endTime: new Date(r.end_time),
    priceFinal: r.price_final,
    paymentStatus: r.payment_status,
  }));

  const summary = buildCustomerLedger(customerId, ledgerGames);
  const byGameId = new Map(rows.map((r) => [r.game_id as number, r]));

  return {
    customerId,
    displayName: customer.displayName,
    isTemporary: customer.isTemporary,
    unsettledGames: summary.unsettledGames.map((g) => {
      const raw = byGameId.get(g.gameId)!;
      return {
        gameId: g.gameId,
        tableNumber: g.tableNumber,
        tableLabel: raw.table_label,
        gameTypeName: g.gameTypeName,
        startTime: raw.start_time,
        endTime: raw.end_time,
        durationBilledMinutes: raw.duration_billed_minutes,
        priceFinal: g.priceFinal,
        paymentStatus: g.paymentStatus,
      };
    }),
    totalOwed: summary.totalOwed,
    spanStart: summary.spanStart?.toISOString() ?? null,
    spanEnd: summary.spanEnd?.toISOString() ?? null,
    spanMinutes: summary.spanMinutes,
  };
}

/** Owner/manager "loan ledger" report — includes nishani (dues tracking is identity-agnostic per spec §2.5). */
export function getLoanLedger(): LoanLedgerRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id AS customer_id, c.display_name, c.is_temporary, c.nishani_description,
              SUM(g.price_final) AS total_owed, COUNT(*) AS unsettled_round_count, MIN(g.start_time) AS oldest_unpaid_at
       FROM games g
       JOIN customers c ON c.id = g.loser_customer_id
       WHERE g.reversed = 0 AND g.end_time IS NOT NULL
         AND g.payment_status IN ('pending','loan','collateral','tricked')
         AND c.merged_into_customer_id IS NULL
       GROUP BY c.id
       ORDER BY total_owed DESC`
    )
    .all() as any[];

  return rows.map((r) => ({
    customerId: r.customer_id,
    displayName: r.display_name,
    isTemporary: !!r.is_temporary,
    nishaniDescription: r.nishani_description,
    totalOwed: r.total_owed,
    unsettledRoundCount: r.unsettled_round_count,
    oldestUnpaidAt: r.oldest_unpaid_at,
  }));
}
