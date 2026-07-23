import type { PrismaClient, Shift } from "@prisma/client";
import { buildZReport, type ZReport } from "@snooker/shared";
import { ApiError } from "../lib/errors";
import { writeAuditLog } from "../lib/audit";

/** POST /shifts/open — opens (or returns the existing) open shift for the caller. */
export async function openShift(prisma: PrismaClient, userId: number): Promise<Shift> {
  const existing = await prisma.shift.findFirst({ where: { userId, closedAt: null } });
  if (existing) return existing;

  const shift = await prisma.$transaction(async (tx) => {
    const created = await tx.shift.create({ data: { userId } });
    await writeAuditLog(tx, {
      entityType: "shift",
      entityId: created.id,
      action: "shift_open",
      performedById: userId,
      beforeValue: null,
      afterValue: created,
    });
    return created;
  });

  return shift;
}

/** Assembles the shared ZReport inputs for a given shift from its linked payments/expenses/games. */
async function computeZReportForShift(
  prisma: PrismaClient,
  shiftId: number,
  declaredCashAmount: number
): Promise<ZReport> {
  const [payments, expenses, games] = await Promise.all([
    prisma.payment.findMany({ where: { shiftId } }),
    prisma.expense.findMany({ where: { shiftId } }),
    prisma.game.findMany({ where: { shiftId, reversed: false } }),
  ]);

  return buildZReport({
    payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
    expenses: expenses.map((e) => ({ method: e.method, amount: e.amount })),
    games: games.map((g) => ({
      paymentStatus: g.paymentStatus as "paid" | "pending" | "loan" | "collateral" | "tricked",
      discountAmount: g.discountAmount,
      priceFinal: g.priceFinal,
    })),
    declaredCashAmount,
  });
}

/**
 * POST /shifts/:id/close — computes the Z-report, locks the shift's
 * entries, and persists the reconciliation fields. Decision #5 / behavioral
 * requirement #1: this is the *same action* as logout force-closing an open
 * shift; both paths funnel through this function.
 */
export async function closeShift(
  prisma: PrismaClient,
  shiftId: number,
  declaredCashAmount: number,
  actor: { userId: number; role: string }
): Promise<{ shift: Shift; zReport: ZReport }> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) throw ApiError.notFound(`Shift ${shiftId} not found`);
  if (shift.closedAt) throw ApiError.conflict("Shift is already closed");

  if (actor.role === "receptionist" && shift.userId !== actor.userId) {
    throw ApiError.forbidden("Receptionists may only close their own shift");
  }

  const zReport = await computeZReportForShift(prisma, shiftId, declaredCashAmount);
  const before = { ...shift };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.shift.update({
      where: { id: shiftId },
      data: {
        closedAt: new Date(),
        declaredCashAmount,
        systemCashTotal: zReport.systemCashTotal,
        cashVariance: zReport.cashVariance,
        isLocked: true,
        closedById: actor.userId,
      },
    });

    await writeAuditLog(tx, {
      entityType: "shift",
      entityId: shiftId,
      action: "shift_close",
      performedById: actor.userId,
      beforeValue: before,
      afterValue: { ...result, zReport },
    });

    return result;
  });

  return { shift: updated, zReport };
}

export async function getZReport(prisma: PrismaClient, shiftId: number): Promise<{ shift: Shift; zReport: ZReport }> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) throw ApiError.notFound(`Shift ${shiftId} not found`);

  // If the shift is already closed, use its locked declared amount so the
  // report is stable/reproducible; otherwise compute live with 0 declared
  // (informational "what would the Z-report show right now" preview).
  const declaredCashAmount = shift.declaredCashAmount ?? 0;
  const zReport = await computeZReportForShift(prisma, shiftId, declaredCashAmount);
  return { shift, zReport };
}

/**
 * Shared by POST /auth/logout and (implicitly) POST /shifts/:id/close:
 * finds the caller's open shift, if any, and force-closes it.
 *
 * Behavioral requirement #1 — declaredCashAmount fallback: when the caller
 * doesn't supply one (e.g. the client just calls /auth/logout without
 * prompting for a cash count first), we default it to the shift's own
 * computed systemCashTotal. That is: assume zero variance rather than
 * guessing, so a forgotten logout never fabricates a shortage/overage on
 * the Z-report. The desktop app's normal flow should still prefer calling
 * POST /shifts/:id/close directly with a real counted cash amount — this
 * fallback exists only so logout never leaves a shift dangling open.
 */
export async function closeOpenShiftForLogout(
  prisma: PrismaClient,
  userId: number,
  declaredCashAmount?: number
): Promise<{ shift: Shift; zReport: ZReport } | null> {
  const openShiftRow = await prisma.shift.findFirst({ where: { userId, closedAt: null } });
  if (!openShiftRow) return null;

  let declared = declaredCashAmount;
  if (declared === undefined) {
    const preview = await computeZReportForShift(prisma, openShiftRow.id, 0);
    declared = preview.systemCashTotal;
  }

  return closeShift(prisma, openShiftRow.id, declared, { userId, role: "owner" });
}
