import { randomUUID } from "node:crypto";
import type { ShiftEntity } from "@snooker/shared";
import { buildZReport, type ZReport } from "@snooker/shared";
import { getDb } from "../client";
import { enqueueSyncWrite } from "./syncQueueRepo";
import { writeAuditLog } from "./auditLogRepo";

function mapRow(row: any): ShiftEntity {
  return {
    id: row.id,
    userId: row.user_id,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    declaredCashAmount: row.declared_cash_amount,
    systemCashTotal: row.system_cash_total,
    cashVariance: row.cash_variance,
    isLocked: !!row.is_locked,
    closedByUserId: row.closed_by_id,
  };
}

export function getOpenShiftForUser(userId: number): ShiftEntity | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM shifts WHERE user_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1`).get(userId);
  return row ? mapRow(row) : null;
}

export function getShiftById(shiftId: number): ShiftEntity {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(shiftId);
  if (!row) throw new Error(`Shift ${shiftId} not found`);
  return mapRow(row);
}

/**
 * Shift open = login (decision #5/#12). If the user already has an unclosed
 * shift (e.g. the app crashed or was force-quit mid-shift last time), it is
 * transparently reused instead of creating a second concurrent shift for the
 * same person — handles that edge case gracefully rather than erroring.
 */
export function openShiftForUser(userId: number): ShiftEntity {
  const existing = getOpenShiftForUser(userId);
  if (existing) return existing;

  const db = getDb();
  const localUuid = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const result = db
      .prepare(`INSERT INTO shifts (local_uuid, user_id, opened_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(localUuid, userId, now, now);
    const row = db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(Number(result.lastInsertRowid));
    const entity = mapRow(row);
    enqueueSyncWrite(db, { localUuid, entityType: "shifts", operation: "insert", payload: entity });
    writeAuditLog(db, {
      entityType: "shifts",
      entityId: entity.id,
      action: "shift_open",
      afterValue: entity,
      performedById: userId,
    });
    return entity;
  });
  return tx();
}

function computeZReportForShift(shiftId: number, declaredCashAmount: number): ZReport {
  const db = getDb();
  const payments = db.prepare(`SELECT method, amount FROM payments WHERE shift_id = ?`).all(shiftId) as {
    method: any;
    amount: number;
  }[];
  const expenses = db.prepare(`SELECT method, amount FROM expenses WHERE shift_id = ?`).all(shiftId) as {
    method: any;
    amount: number;
  }[];
  const games = db
    .prepare(
      `SELECT payment_status, discount_amount, price_final FROM games
       WHERE shift_id = ? AND reversed = 0 AND end_time IS NOT NULL`
    )
    .all(shiftId) as { payment_status: any; discount_amount: number; price_final: number }[];

  return buildZReport({
    payments,
    expenses,
    games: games.map((g) => ({
      paymentStatus: g.payment_status,
      discountAmount: g.discount_amount,
      priceFinal: g.price_final,
    })),
    declaredCashAmount,
  });
}

/** Preview shown on ShiftCloseScreen before the receptionist enters declared cash. */
export function previewZReport(shiftId: number): ZReport {
  return computeZReportForShift(shiftId, 0);
}

/**
 * Shift close = logout (decision #5/#6). Locks the shift's entries and
 * produces the final Z-report. The caller (ipc handlers.ts) always ends the
 * session immediately after this returns, regardless of whether the flow was
 * entered via "Log Out" or "Close Shift" — both buttons converge here.
 */
export function closeShift(input: { shiftId: number; declaredCashAmount: number; closedByUserId: number }): {
  shift: ShiftEntity;
  zReport: ZReport;
} {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const before = getShiftById(input.shiftId);
    const zReport = computeZReportForShift(input.shiftId, input.declaredCashAmount);

    db.prepare(
      `UPDATE shifts SET closed_at = ?, declared_cash_amount = ?, system_cash_total = ?, cash_variance = ?, is_locked = 1, closed_by_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      now,
      input.declaredCashAmount,
      zReport.systemCashTotal,
      zReport.cashVariance,
      input.closedByUserId,
      now,
      input.shiftId
    );

    const after = getShiftById(input.shiftId);
    enqueueSyncWrite(db, { localUuid: randomUUID(), entityType: "shifts", operation: "update", payload: after });
    writeAuditLog(db, {
      entityType: "shifts",
      entityId: input.shiftId,
      action: "shift_close",
      beforeValue: before,
      afterValue: { ...after, zReport },
      performedById: input.closedByUserId,
    });
    return { shift: after, zReport };
  });
  return tx();
}
