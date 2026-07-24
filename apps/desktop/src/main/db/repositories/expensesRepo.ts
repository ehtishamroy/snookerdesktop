import { randomUUID } from "node:crypto";
import type { ExpenseEntity } from "@snooker/shared";
import { getDb } from "../client";
import { enqueueSyncWrite } from "./syncQueueRepo";
import { writeAuditLog } from "./auditLogRepo";
import type { CreateExpenseInput, ExpenseListFilter, UpdateExpenseInput } from "../../../ipc/contract";

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
    edited: !!row.edited,
    editedAt: row.edited_at,
    editedById: row.edited_by_id,
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

/**
 * Any staff member can correct an expense they (or a colleague) mis-entered —
 * matching the "unrestricted but always attributed" philosophy discounts
 * already use (decision #3). Every edit sets edited/editedAt/editedById so
 * the owner can spot a corrected entry in the list at a glance, on top of
 * the full before/after this still writes to audit_log.
 */
export function updateExpense(input: UpdateExpenseInput): ExpenseEntity {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const before = mapRow(db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(input.expenseId));
    if (!before) throw new Error(`Expense ${input.expenseId} not found`);

    const sets: string[] = [];
    const params: unknown[] = [];
    const columnByField: Record<string, string> = {
      category: "category",
      amount: "amount",
      method: "method",
      note: "note",
    };
    for (const [field, value] of Object.entries(input.patch)) {
      if (value === undefined) continue;
      sets.push(`${columnByField[field]} = ?`);
      params.push(value);
    }
    sets.push("edited = 1", "edited_at = ?", "edited_by_id = ?");
    params.push(now, input.performedByUserId, input.expenseId);
    db.prepare(`UPDATE expenses SET ${sets.join(", ")} WHERE id = ?`).run(...params);

    const after = mapRow(db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(input.expenseId));
    enqueueSyncWrite(db, { localUuid: randomUUID(), entityType: "expenses", operation: "update", payload: after });
    writeAuditLog(db, {
      entityType: "expenses",
      entityId: input.expenseId,
      action: "update",
      beforeValue: before,
      afterValue: after,
      performedById: input.performedByUserId,
    });
    return after;
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
