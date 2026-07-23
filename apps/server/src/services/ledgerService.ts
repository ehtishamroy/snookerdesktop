import type { PrismaClient } from "@prisma/client";
import { buildCustomerLedger, validateSettlement, type LedgerGame } from "@snooker/shared";
import { ApiError } from "../lib/errors";
import { writeAuditLog } from "../lib/audit";

const UNSETTLED_STATUSES = ["pending", "loan", "collateral", "tricked"] as const;

async function fetchUnsettledLedgerGames(
  prisma: PrismaClient,
  customerId: number
): Promise<LedgerGame[]> {
  const games = await prisma.game.findMany({
    where: {
      loserCustomerId: customerId,
      reversed: false,
      paymentStatus: { in: [...UNSETTLED_STATUSES] },
    },
    include: { table: true, gameType: true },
    orderBy: { startTime: "asc" },
  });

  return games
    .filter((g) => g.endTime !== null) // an in-progress round has no final price yet
    .map((g) => ({
      gameId: g.id,
      tableNumber: g.table.tableNumber,
      gameTypeName: g.gameType.name,
      startTime: g.startTime,
      endTime: g.endTime as Date,
      priceFinal: g.priceFinal,
      paymentStatus: g.paymentStatus as LedgerGame["paymentStatus"],
    }));
}

export async function getCustomerLedger(prisma: PrismaClient, customerId: number) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw ApiError.notFound(`Customer ${customerId} not found`);

  const ledgerGames = await fetchUnsettledLedgerGames(prisma, customerId);
  return buildCustomerLedger(customerId, ledgerGames);
}

export async function getLoanLedgerOverview(prisma: PrismaClient) {
  const rows = await prisma.game.groupBy({
    by: ["loserCustomerId"],
    where: {
      reversed: false,
      paymentStatus: { in: [...UNSETTLED_STATUSES] },
      loserCustomerId: { not: null },
      endTime: { not: null },
    },
    _sum: { priceFinal: true },
    _count: { _all: true },
  });

  const customerIds = rows.map((r) => r.loserCustomerId).filter((id): id is number => id !== null);
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } } });
  const byId = new Map(customers.map((c) => [c.id, c]));

  return rows
    .map((r) => ({
      customerId: r.loserCustomerId as number,
      customer: byId.get(r.loserCustomerId as number) ?? null,
      totalOwed: r._sum.priceFinal ?? 0,
      unsettledCount: r._count._all,
    }))
    .filter((r) => r.customer !== null && !r.customer.isTemporary)
    .sort((a, b) => b.totalOwed - a.totalOwed);
}

export interface SettlePaymentInput {
  customerId: number;
  amount: number;
  method: "cash" | "easypaisa" | "jazzcash" | "card";
  note?: string;
  gameIds: number[];
}

/**
 * POST /payments — settles a subset (or all) of a customer's unsettled
 * rounds (partial settlement support). Validated with the shared
 * `validateSettlement` so the rule ("only touch games that are actually
 * still unsettled for this customer") can never drift between server and
 * desktop. We additionally require the paid `amount` to equal the sum of
 * the selected rounds' final prices — a payment settles specific rounds in
 * full, there's no concept of a partial amount against a single round.
 */
export async function settlePayment(
  prisma: PrismaClient,
  input: SettlePaymentInput,
  actor: { userId: number }
) {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw ApiError.notFound(`Customer ${input.customerId} not found`);

  const ledgerGames = await fetchUnsettledLedgerGames(prisma, input.customerId);
  const ledger = buildCustomerLedger(input.customerId, ledgerGames);

  const validation = validateSettlement(ledger, {
    selectedGameIds: input.gameIds,
    amount: input.amount,
    method: input.method,
  });
  if (!validation.valid) {
    throw ApiError.badRequest(validation.error ?? "Invalid settlement selection");
  }

  const selectedGames = ledger.unsettledGames.filter((g) => input.gameIds.includes(g.gameId));
  const expectedTotal = selectedGames.reduce((sum, g) => sum + g.priceFinal, 0);
  if (input.amount !== expectedTotal) {
    throw ApiError.badRequest(
      `Payment amount (${input.amount}) must equal the sum of the selected rounds' price (${expectedTotal})`
    );
  }

  const shift = await prisma.shift.findFirst({ where: { userId: actor.userId, closedAt: null } });
  if (!shift) throw ApiError.badRequest("You must open a shift before collecting a payment");

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        customerId: input.customerId,
        amount: input.amount,
        method: input.method,
        note: input.note,
        collectedByUserId: actor.userId,
        shiftId: shift.id,
        gameLinks: {
          create: input.gameIds.map((gameId) => ({ gameId })),
        },
      },
      include: { gameLinks: true },
    });

    await writeAuditLog(tx, {
      entityType: "payment",
      entityId: created.id,
      action: "create",
      performedById: actor.userId,
      beforeValue: null,
      afterValue: created,
    });

    for (const gameId of input.gameIds) {
      const beforeGame = await tx.game.findUnique({ where: { id: gameId } });
      const afterGame = await tx.game.update({
        where: { id: gameId },
        data: { paymentStatus: "paid" },
      });
      await writeAuditLog(tx, {
        entityType: "game",
        entityId: gameId,
        action: "update",
        performedById: actor.userId,
        beforeValue: beforeGame,
        afterValue: afterGame,
      });
    }

    return created;
  });

  return payment;
}
