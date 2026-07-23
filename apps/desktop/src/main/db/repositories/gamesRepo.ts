import { randomUUID } from "node:crypto";
import { startOfDay } from "date-fns";
import type Database from "better-sqlite3";
import type { GameEntity, PaymentEntity, PaymentStatus } from "@snooker/shared";
import { applyDiscount, checkIdleAlert, computeBilling, minutesElapsed } from "@snooker/shared";
import { getDb } from "../client";
import { enqueueSyncWrite } from "./syncQueueRepo";
import { writeAuditLog } from "./auditLogRepo";
import { getTableById } from "./tablesRepo";
import { resolvePricingBlock } from "./pricingRulesRepo";
import { markOccupied, markVacant } from "./tableStatusLogRepo";
import { insertCollateralItem } from "./collateralRepo";
import type {
  CurrentGameView,
  DashboardSummary,
  EndGameInput,
  GameListFilter,
  IdleAlertItem,
  ReverseGameInput,
  StartGameInput,
  TableTileView,
  UpdateGameInput,
} from "../../../ipc/contract";

function mapRow(row: any): GameEntity {
  return {
    id: row.id,
    localUuid: row.local_uuid,
    tableId: row.table_id,
    gameTypeId: row.game_type_id,
    startTime: row.start_time,
    endTime: row.end_time,
    durationActualMinutes: row.duration_actual_minutes,
    durationBilledMinutes: row.duration_billed_minutes,
    priceOriginal: row.price_original,
    discountAmount: row.discount_amount,
    discountReason: row.discount_reason,
    discountByUserId: row.discount_by_id,
    priceFinal: row.price_final,
    loserCustomerId: row.loser_customer_id,
    winnerCustomerId: row.winner_customer_id,
    paymentStatus: row.payment_status,
    createdByUserId: row.created_by_user_id,
    shiftId: row.shift_id,
    reversed: !!row.reversed,
    reversedBy: row.reversed_by_id,
    reversedReason: row.reversed_reason,
    reversedAt: row.reversed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getGameRowById(db: Database.Database, gameId: number): any {
  const row = db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId);
  if (!row) throw new Error(`Game ${gameId} not found`);
  return row;
}

export function getGameById(gameId: number): GameEntity {
  return mapRow(getGameRowById(getDb(), gameId));
}

/** Start/Save Game button — table becomes occupied immediately, price shown is the full block price until checkout. */
export function startGame(input: StartGameInput): GameEntity {
  const db = getDb();
  const localUuid = randomUUID();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    const table = getTableById(db, input.tableId);
    if (!table.isActive) throw new Error(`Table ${table.tableNumber} is inactive`);

    const block = resolvePricingBlock(db, table.tableType, input.gameTypeId, input.startTime);

    const result = db
      .prepare(
        `INSERT INTO games (
           local_uuid, table_id, game_type_id, start_time, price_original, discount_amount, price_final,
           loser_customer_id, winner_customer_id, payment_status, created_by_user_id, shift_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', ?, ?, ?, ?)`
      )
      .run(
        localUuid,
        input.tableId,
        input.gameTypeId,
        input.startTime,
        block.blockPrice,
        block.blockPrice,
        input.loserCustomerId,
        input.winnerCustomerId ?? null,
        input.createdByUserId,
        input.shiftId,
        now,
        now
      );

    const entity = mapRow(getGameRowById(db, Number(result.lastInsertRowid)));
    markOccupied(db, input.tableId, input.startTime);
    enqueueSyncWrite(db, { localUuid, entityType: "games", operation: "insert", payload: entity });
    writeAuditLog(db, {
      entityType: "games",
      entityId: entity.id,
      action: "create",
      afterValue: entity,
      performedById: input.createdByUserId,
    });
    return entity;
  });

  return tx();
}

/**
 * End Game & Checkout — computes duration/overtime via @snooker/shared's
 * computeBilling (never hand-rolled here), applies any discount via
 * @snooker/shared's applyDiscount (no approval gate, decision #3), records
 * the payment status, and — if Paid — immediately settles this single round,
 * or — if Collateral — logs the held item.
 */
export function endGame(input: EndGameInput): GameEntity {
  const db = getDb();
  const now = new Date().toISOString();

  if (input.paymentStatus === "paid" && !input.paymentMethod) {
    throw new Error("A payment method is required whenever a round is marked Paid");
  }
  if (input.paymentStatus === "collateral" && !input.collateralDescription?.trim()) {
    throw new Error("A collateral item description is required whenever a round is marked Collateral");
  }

  const tx = db.transaction(() => {
    const before = mapRow(getGameRowById(db, input.gameId));
    if (before.reversed) throw new Error("Cannot end a reversed game");
    if (before.endTime) throw new Error("This game was already ended");

    const table = getTableById(db, before.tableId);
    // Overtime billing must reflect the price that was active when the game
    // STARTED (decision #2), not whatever the current live pricing is.
    const block = resolvePricingBlock(db, table.tableType, before.gameTypeId, before.startTime);
    const durationActualMinutes = minutesElapsed(new Date(before.startTime), new Date(input.endTime));
    const billing = computeBilling(block, Math.max(0, durationActualMinutes));

    const priceOriginal = input.priceOverride ?? billing.priceOriginal;
    const discount = applyDiscount({
      priceOriginal,
      discountAmount: input.discountAmount,
      discountPercent: input.discountPercent,
    });

    db.prepare(
      `UPDATE games SET
         end_time = ?, duration_actual_minutes = ?, duration_billed_minutes = ?,
         price_original = ?, discount_amount = ?, discount_reason = ?, discount_by_id = ?,
         price_final = ?, payment_status = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.endTime,
      billing.durationActualMinutes,
      billing.durationBilledMinutes,
      priceOriginal,
      discount.discountAmount,
      input.discountReason ?? null,
      discount.discountAmount > 0 ? input.discountByUserId ?? input.performedByUserId : null,
      discount.priceFinal,
      input.paymentStatus,
      now,
      input.gameId
    );

    markVacant(db, before.tableId, input.endTime);

    if (input.paymentStatus === "paid") {
      settlePaymentForGames(db, {
        customerId: before.loserCustomerId,
        gameIds: [input.gameId],
        amount: discount.priceFinal,
        method: input.paymentMethod!,
        note: undefined,
        collectedByUserId: input.performedByUserId,
        shiftId: input.shiftId,
      });
    } else if (input.paymentStatus === "collateral") {
      insertCollateralItem(db, {
        gameId: input.gameId,
        customerId: before.loserCustomerId,
        itemDescription: input.collateralDescription!,
        heldByUserId: input.performedByUserId,
      });
    }

    const after = mapRow(getGameRowById(db, input.gameId));
    enqueueSyncWrite(db, { localUuid: randomUUID(), entityType: "games", operation: "update", payload: after });
    writeAuditLog(db, {
      entityType: "games",
      entityId: input.gameId,
      action: "update",
      beforeValue: before,
      afterValue: after,
      performedById: input.performedByUserId,
    });
    return after;
  });

  return tx();
}

/** Shared by endGame()'s "Paid at checkout" path and paymentsRepo.settle()'s explicit Ledger-screen settlement. */
export function settlePaymentForGames(
  db: Database.Database,
  input: { customerId: number; gameIds: number[]; amount: number; method: string; note?: string; collectedByUserId: number; shiftId: number }
): PaymentEntity {
  const localUuid = randomUUID();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO payments (local_uuid, customer_id, amount, method, note, paid_at, collected_by_user_id, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(localUuid, input.customerId, input.amount, input.method, input.note ?? null, now, input.collectedByUserId, input.shiftId);
  const paymentId = Number(result.lastInsertRowid);

  const linkStmt = db.prepare(`INSERT INTO payment_game_links (payment_id, game_id) VALUES (?, ?)`);
  const updateGameStatusStmt = db.prepare(`UPDATE games SET payment_status = 'paid', updated_at = ? WHERE id = ?`);
  for (const gameId of input.gameIds) {
    linkStmt.run(paymentId, gameId);
    updateGameStatusStmt.run(now, gameId);
  }

  const entity: PaymentEntity = {
    id: paymentId,
    customerId: input.customerId,
    amount: input.amount,
    method: input.method as PaymentEntity["method"],
    note: input.note ?? null,
    paidAt: now,
    collectedByUserId: input.collectedByUserId,
    shiftId: input.shiftId,
    gameIds: input.gameIds,
  };
  enqueueSyncWrite(db, { localUuid, entityType: "payments", operation: "insert", payload: entity });
  return entity;
}

/** Generic post-hoc correction to a game record (time/price/payment-status edits) — always audited. */
export function updateGame(input: UpdateGameInput): GameEntity {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const before = mapRow(getGameRowById(db, input.gameId));
    const sets: string[] = [];
    const params: unknown[] = [];
    const columnByField: Record<string, string> = {
      startTime: "start_time",
      endTime: "end_time",
      priceFinal: "price_final",
      discountAmount: "discount_amount",
      discountReason: "discount_reason",
      paymentStatus: "payment_status",
      winnerCustomerId: "winner_customer_id",
      loserCustomerId: "loser_customer_id",
    };
    for (const [field, value] of Object.entries(input.patch)) {
      if (value === undefined) continue;
      sets.push(`${columnByField[field]} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return before;
    sets.push("updated_at = ?");
    params.push(now);
    params.push(input.gameId);
    db.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).run(...params);

    const after = mapRow(getGameRowById(db, input.gameId));
    enqueueSyncWrite(db, { localUuid: randomUUID(), entityType: "games", operation: "update", payload: after });
    writeAuditLog(db, {
      entityType: "games",
      entityId: input.gameId,
      action: "update",
      beforeValue: before,
      afterValue: after,
      performedById: input.performedByUserId,
    });
    return after;
  });
  return tx();
}

/** Soft-delete only — no record is ever hard-deleted (spec §2.8). Excluded from revenue, stays in Edit/Reversal history. */
export function reverseGame(input: ReverseGameInput): GameEntity {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const before = mapRow(getGameRowById(db, input.gameId));
    if (before.reversed) throw new Error("Game is already reversed");

    db.prepare(
      `UPDATE games SET reversed = 1, reversed_by_id = ?, reversed_reason = ?, reversed_at = ?, updated_at = ? WHERE id = ?`
    ).run(input.performedByUserId, input.reason, now, now, input.gameId);

    if (!before.endTime) {
      // Cancelling an in-progress round frees the table immediately.
      markVacant(db, before.tableId, now);
    }

    const after = mapRow(getGameRowById(db, input.gameId));
    enqueueSyncWrite(db, { localUuid: randomUUID(), entityType: "games", operation: "update", payload: after });
    writeAuditLog(db, {
      entityType: "games",
      entityId: input.gameId,
      action: "reverse",
      beforeValue: before,
      afterValue: after,
      performedById: input.performedByUserId,
    });
    return after;
  });
  return tx();
}

export function listGames(filter: GameListFilter): GameEntity[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.tableId !== undefined) {
    clauses.push("table_id = ?");
    params.push(filter.tableId);
  }
  if (filter.customerId !== undefined) {
    clauses.push("(loser_customer_id = ? OR winner_customer_id = ?)");
    params.push(filter.customerId, filter.customerId);
  }
  if (filter.from) {
    clauses.push("start_time >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("start_time <= ?");
    params.push(filter.to);
  }
  if (filter.paymentStatus) {
    clauses.push("payment_status = ?");
    params.push(filter.paymentStatus);
  }
  if (filter.reversed !== undefined) {
    clauses.push("reversed = ?");
    params.push(filter.reversed ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM games ${where} ORDER BY start_time DESC LIMIT 500`).all(...params);
  return (rows as any[]).map(mapRow);
}

// ---------------------------------------------------------------------------
// Dashboard tiles / idle alerts — read models that stitch several tables
// together for the Main Dashboard and the idle-timeout poller.
// ---------------------------------------------------------------------------

export function getTableTiles(): TableTileView[] {
  const db = getDb();
  const tables = db.prepare(`SELECT * FROM tables ORDER BY table_number ASC`).all() as any[];
  const todayStart = startOfDay(new Date()).toISOString();
  const now = new Date();

  return tables.map((t) => {
    const statusRow = db
      .prepare(`SELECT status FROM table_status_log WHERE table_id = ? AND status_to IS NULL ORDER BY id DESC LIMIT 1`)
      .get(t.id) as { status: "occupied" | "vacant" } | undefined;
    const status = statusRow?.status ?? "vacant";

    let currentGame: CurrentGameView | null = null;
    if (status === "occupied") {
      const gameRow = db
        .prepare(
          `SELECT g.*, gt.name AS game_type_name, gt.code AS game_type_code,
                  lc.display_name AS loser_name, wc.display_name AS winner_name
           FROM games g
           JOIN game_types gt ON gt.id = g.game_type_id
           JOIN customers lc ON lc.id = g.loser_customer_id
           LEFT JOIN customers wc ON wc.id = g.winner_customer_id
           WHERE g.table_id = ? AND g.end_time IS NULL AND g.reversed = 0
           ORDER BY g.start_time DESC LIMIT 1`
        )
        .get(t.id) as any;

      if (gameRow) {
        const block = resolvePricingBlock(db, t.table_type, gameRow.game_type_id, gameRow.start_time);
        const idle = checkIdleAlert({
          startTime: new Date(gameRow.start_time),
          now,
          blockDurationMinutes: block.blockDurationMinutes,
        });
        currentGame = {
          gameId: gameRow.id,
          gameTypeId: gameRow.game_type_id,
          gameTypeName: gameRow.game_type_name,
          gameTypeCode: gameRow.game_type_code,
          startTime: gameRow.start_time,
          loserCustomerId: gameRow.loser_customer_id,
          loserName: gameRow.loser_name,
          winnerCustomerId: gameRow.winner_customer_id,
          winnerName: gameRow.winner_name,
          blockDurationMinutes: block.blockDurationMinutes,
          elapsedMinutes: idle.minutesElapsed,
          isIdleAlert: idle.isIdleAlert,
        };
      }
    }

    const earningsRow = db
      .prepare(
        `SELECT COALESCE(SUM(price_final), 0) AS total FROM games
         WHERE table_id = ? AND reversed = 0 AND end_time IS NOT NULL AND start_time >= ?`
      )
      .get(t.id, todayStart) as { total: number };

    return {
      table: {
        id: t.id,
        tableNumber: t.table_number,
        tableType: t.table_type,
        label: t.label,
        isActive: !!t.is_active,
      },
      status,
      currentGame,
      todayEarnings: earningsRow.total,
    };
  });
}

export function getDashboardSummary(): DashboardSummary {
  const db = getDb();
  const todayStart = startOfDay(new Date()).toISOString();

  const revenueRow = db
    .prepare(
      `SELECT COALESCE(SUM(price_final), 0) AS total FROM games
       WHERE reversed = 0 AND end_time IS NOT NULL AND start_time >= ?`
    )
    .get(todayStart) as { total: number };

  const pendingRow = db
    .prepare(
      `SELECT COALESCE(SUM(price_final), 0) AS total FROM games
       WHERE reversed = 0 AND end_time IS NOT NULL AND payment_status IN ('pending','loan','collateral','tricked')`
    )
    .get() as { total: number };

  const statusCounts = db
    .prepare(
      `SELECT t.id,
              COALESCE((SELECT status FROM table_status_log WHERE table_id = t.id AND status_to IS NULL ORDER BY id DESC LIMIT 1), 'vacant') AS status
       FROM tables t`
    )
    .all() as { id: number; status: "occupied" | "vacant" }[];

  return {
    totalRevenueToday: revenueRow.total,
    pendingDuesTotal: pendingRow.total,
    occupiedCount: statusCounts.filter((s) => s.status === "occupied").length,
    vacantCount: statusCounts.filter((s) => s.status === "vacant").length,
  };
}

/** Used by sync/idleAlertPoller.ts every ~30s (decision #16). */
export function getIdleAlerts(): IdleAlertItem[] {
  const db = getDb();
  const now = new Date();
  const rows = db
    .prepare(
      `SELECT g.id AS game_id, g.table_id, t.table_number, t.label AS table_label, t.table_type,
              g.game_type_id, gt.name AS game_type_name, g.start_time, lc.display_name AS loser_name
       FROM games g
       JOIN tables t ON t.id = g.table_id
       JOIN game_types gt ON gt.id = g.game_type_id
       JOIN customers lc ON lc.id = g.loser_customer_id
       WHERE g.end_time IS NULL AND g.reversed = 0`
    )
    .all() as any[];

  const alerts: IdleAlertItem[] = [];
  for (const row of rows) {
    const block = resolvePricingBlock(db, row.table_type, row.game_type_id, row.start_time);
    const idle = checkIdleAlert({ startTime: new Date(row.start_time), now, blockDurationMinutes: block.blockDurationMinutes });
    if (idle.isIdleAlert) {
      alerts.push({
        gameId: row.game_id,
        tableId: row.table_id,
        tableNumber: row.table_number,
        tableLabel: row.table_label,
        gameTypeName: row.game_type_name,
        loserName: row.loser_name,
        minutesElapsed: idle.minutesElapsed,
        thresholdMinutes: idle.thresholdMinutes,
      });
    }
  }
  return alerts;
}
