import { randomUUID } from "node:crypto";
import type { ExpenseEntity } from "@snooker/shared";
import { getDb } from "../client";
import { enqueueSyncWrite } from "./syncQueueRepo";
import { writeAuditLog } from "./auditLogRepo";
import type { CreateExpenseInput, ExpenseListFilter } from "../../../ipc/contract";

function mapRow(row: any): ExpenseEntity {
  return {
    id: row.id,
    category: row.category,
    amount: row.amount,
    method: row.method,
    note: row.note,
    spentAt: row.spent_at,
    recordedByUserId: row.recorded_by_user_id,
    shiftId: row.shift_id,
  };
}

/**
 * Decision #11: replaces a full canteen/inventory POS with a simple expense
 * ledger — money paid out of the drawer (restocking, repairs, etc.), which
 * reduces cash-in-hand in the Z-report (@snooker/shared buildZReport).
 */
export function createExpense(input: CreateExpenseInput): ExpenseEntity {
  const db = getDb();
  const localUuid = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO expenses (local_uuid, category, amount, method, note, spent_at, recorded_by_user_id, shift_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(localUuid, input.category.trim(), input.amount, input.method, input.note ?? null, now, input.recordedByUserId, input.shiftId);
    const row = db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(Number(result.lastInsertRowid));
    const entity = mapRow(row);
    enqueueSyncWrite(db, { localUuid, entityType: "expenses", operation: "insert", payload: entity });
    writeAuditLog(db, {
      entityType: "expenses",
      entityId: entity.id,
      action: "create",
      afterValue: entity,
      performedById: input.recordedByUserId,
    });
    return entity;
  });
  return tx();
}

export function listExpenses(filter: ExpenseListFilter): ExpenseEntity[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.from) {
    clauses.push("spent_at >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("spent_at <= ?");
    params.push(filter.to);
  }
  if (filter.shiftId !== undefined) {
    clauses.push("shift_id = ?");
    params.push(filter.shiftId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM expenses ${where} ORDER BY spent_at DESC LIMIT 500`).all(...params);
  return (rows as any[]).map(mapRow);
}
