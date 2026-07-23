import type { LedgerGame, PaymentEntity } from "@snooker/shared";
import { buildCustomerLedger, validateSettlement } from "@snooker/shared";
import { getDb } from "../client";
import { writeAuditLog } from "./auditLogRepo";
import { settlePaymentForGames, updateGame } from "./gamesRepo";
import type { SettleInput } from "../../../ipc/contract";

/**
 * Customer Ledger / Settle-Up screen (spec §5.3): settles any subset of a
 * customer's unpaid rounds at once — the "losing chain" scenario. The
 * settlement amount is always computed server-side (here) as the exact sum
 * of the selected rounds' priceFinal, never trusted from the renderer, and
 * validated with @snooker/shared's validateSettlement so a stale/duplicate
 * selection (e.g. a round someone else just settled from another PC) is
 * rejected rather than silently double-charged.
 *
 * A discount here (decision #3 — unrestricted, any staff, any amount) is
 * spread proportionally across the selected rounds' own price_final/
 * discount_amount, via the same audited/synced updateGame() path End Game
 * uses — so the customer's per-round history and revenue reports stay
 * accurate rather than just quietly collecting less than the rounds say
 * they're worth. The last round absorbs the rounding remainder so the
 * total is always exact.
 */
export function settle(input: SettleInput): PaymentEntity {
  const db = getDb();
  const tx = db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT g.id AS game_id, t.table_number, gt.name AS game_type_name, g.start_time, g.end_time, g.price_final, g.payment_status, g.discount_amount
         FROM games g
         JOIN tables t ON t.id = g.table_id
         JOIN game_types gt ON gt.id = g.game_type_id
         WHERE g.loser_customer_id = ? AND g.reversed = 0 AND g.end_time IS NOT NULL
           AND g.payment_status IN ('pending','loan','collateral','tricked')`
      )
      .all(input.customerId) as any[];

    const ledgerGames: LedgerGame[] = rows.map((r) => ({
      gameId: r.game_id,
      tableNumber: r.table_number,
      gameTypeName: r.game_type_name,
      startTime: new Date(r.start_time),
      endTime: new Date(r.end_time),
      priceFinal: r.price_final,
      paymentStatus: r.payment_status,
    }));
    const ledger = buildCustomerLedger(input.customerId, ledgerGames);
    const existingDiscountByGameId = new Map(rows.map((r) => [r.game_id as number, r.discount_amount as number]));

    const selected = ledger.unsettledGames.filter((g) => input.selectedGameIds.includes(g.gameId));
    const originalAmount = selected.reduce((sum, g) => sum + g.priceFinal, 0);

    const validation = validateSettlement(ledger, {
      selectedGameIds: input.selectedGameIds,
      amount: originalAmount,
      method: input.method,
    });
    if (!validation.valid) throw new Error(validation.error);

    const discountAmount = Math.min(Math.max(0, input.discountAmount ?? 0), originalAmount);
    let amount = originalAmount;

    if (discountAmount > 0) {
      let remaining = discountAmount;
      selected.forEach((g, i) => {
        const isLast = i === selected.length - 1;
        const share = isLast ? remaining : Math.min(remaining, Math.round((g.priceFinal / originalAmount) * discountAmount));
        remaining -= share;
        if (share <= 0) return;
        const existingDiscount = existingDiscountByGameId.get(g.gameId) ?? 0;
        updateGame({
          gameId: g.gameId,
          patch: {
            priceFinal: g.priceFinal - share,
            discountAmount: existingDiscount + share,
            discountReason: input.discountReason,
          },
          performedByUserId: input.collectedByUserId,
          reason: input.discountReason ?? "Discount applied at ledger settlement",
        });
      });
      amount = originalAmount - discountAmount;
    }

    const payment = settlePaymentForGames(db, {
      customerId: input.customerId,
      gameIds: input.selectedGameIds,
      amount,
      method: input.method,
      note: input.note,
      collectedByUserId: input.collectedByUserId,
      shiftId: input.shiftId,
    });

    writeAuditLog(db, {
      entityType: "payments",
      entityId: payment.id,
      action: "create",
      afterValue: payment,
      performedById: input.collectedByUserId,
    });

    return payment;
  });
  return tx();
}
