import type { Game, PaymentStatus, PrismaClient } from "@prisma/client";
import { computeBilling, applyDiscount } from "@snooker/shared";
import { ApiError } from "../lib/errors";
import { writeAuditLog } from "../lib/audit";
import { resolvePricingRule } from "./pricingService";
import { closeVacantWindow, openVacantWindow } from "./tableStatusService";

export interface CreateGameInput {
  localUuid: string;
  tableId: number;
  gameTypeId: number;
  startTime: string;
  loserCustomerId: number;
  winnerCustomerId?: number | null;
  paymentStatus?: PaymentStatus;
  discountAmount?: number;
  discountPercent?: number;
  discountReason?: string;
}

/**
 * Resolves the (possibly merged) customer id a game should actually point
 * at. If the id given belongs to a customer that has already been merged
 * into another one, we refuse rather than silently creating history against
 * a dead-end row — the caller (desktop UI) should have refreshed its
 * customer list after a merge.
 */
async function assertNotMergedAway(prisma: PrismaClient, customerId: number, label: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw ApiError.badRequest(`${label} customer ${customerId} does not exist`);
  if (customer.mergedIntoCustomerId !== null) {
    throw ApiError.conflict(
      `${label} customer ${customerId} was merged into customer ${customer.mergedIntoCustomerId}; use that id instead`
    );
  }
  return customer;
}

export async function createGame(
  prisma: PrismaClient,
  input: CreateGameInput,
  createdByUserId: number
): Promise<Game> {
  // Idempotency: a direct POST /games retry (e.g. flaky connection on the
  // desktop app) with the same localUuid returns the existing row instead
  // of erroring or duplicating it — same spirit as the /sync/push contract.
  const existing = await prisma.game.findUnique({ where: { localUuid: input.localUuid } });
  if (existing) return existing;

  const table = await prisma.table.findUnique({ where: { id: input.tableId } });
  if (!table) throw ApiError.badRequest(`Table ${input.tableId} does not exist`);
  if (!table.isActive) throw ApiError.badRequest(`Table ${table.label} is not active`);

  const gameType = await prisma.gameType.findUnique({ where: { id: input.gameTypeId } });
  if (!gameType) throw ApiError.badRequest(`Game type ${input.gameTypeId} does not exist`);
  if (!gameType.isActive) throw ApiError.badRequest(`Game type ${gameType.name} is not active`);

  await assertNotMergedAway(prisma, input.loserCustomerId, "Loser");
  if (input.winnerCustomerId != null) {
    await assertNotMergedAway(prisma, input.winnerCustomerId, "Winner");
  }

  const shift = await prisma.shift.findFirst({
    where: { userId: createdByUserId, closedAt: null },
  });
  if (!shift) {
    throw ApiError.badRequest("You must open a shift before starting a game");
  }

  const startTime = new Date(input.startTime);
  if (Number.isNaN(startTime.getTime())) throw ApiError.badRequest("Invalid startTime");

  const block = await resolvePricingRule(prisma, table.tableType, gameType.id, startTime);
  const { discountAmount, priceFinal } = applyDiscount({
    priceOriginal: block.blockPrice,
    discountAmount: input.discountAmount,
    discountPercent: input.discountPercent,
  });

  const game = await prisma.$transaction(async (tx) => {
    const created = await tx.game.create({
      data: {
        localUuid: input.localUuid,
        tableId: table.id,
        gameTypeId: gameType.id,
        startTime,
        priceOriginal: block.blockPrice,
        discountAmount,
        discountReason: input.discountReason,
        discountById: discountAmount > 0 ? createdByUserId : null,
        priceFinal,
        loserCustomerId: input.loserCustomerId,
        winnerCustomerId: input.winnerCustomerId ?? null,
        paymentStatus: input.paymentStatus ?? "pending",
        createdByUserId,
        shiftId: shift.id,
      },
    });

    await closeVacantWindow(tx, table.id, startTime);

    await writeAuditLog(tx, {
      entityType: "game",
      entityId: created.id,
      action: "create",
      performedById: createdByUserId,
      beforeValue: null,
      afterValue: created,
    });

    return created;
  });

  return game;
}

export interface UpdateGameInput {
  endTime?: string;
  tableId?: number;
  gameTypeId?: number;
  winnerCustomerId?: number | null;
  paymentStatus?: PaymentStatus;
  discountAmount?: number;
  discountPercent?: number;
  discountReason?: string;
  /** Manual override of the final price, bypassing computed billing/discount entirely. */
  priceOverride?: number;
}

export async function updateGame(
  prisma: PrismaClient,
  gameId: number,
  input: UpdateGameInput,
  actor: { userId: number; role: string }
): Promise<Game> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw ApiError.notFound(`Game ${gameId} not found`);
  if (game.reversed) throw ApiError.conflict("Cannot edit a reversed game");

  if (actor.role === "receptionist" && game.createdByUserId !== actor.userId) {
    throw ApiError.forbidden("Receptionists may only edit games from their own shift");
  }

  const before = { ...game };

  let tableId = game.tableId;
  let gameTypeId = game.gameTypeId;
  let repriceNeeded = false;

  if (input.tableId !== undefined && input.tableId !== game.tableId) {
    const table = await prisma.table.findUnique({ where: { id: input.tableId } });
    if (!table) throw ApiError.badRequest(`Table ${input.tableId} does not exist`);
    tableId = table.id;
    repriceNeeded = true;
  }
  if (input.gameTypeId !== undefined && input.gameTypeId !== game.gameTypeId) {
    const gameType = await prisma.gameType.findUnique({ where: { id: input.gameTypeId } });
    if (!gameType) throw ApiError.badRequest(`Game type ${input.gameTypeId} does not exist`);
    gameTypeId = gameType.id;
    repriceNeeded = true;
  }
  if (input.winnerCustomerId !== undefined && input.winnerCustomerId !== null) {
    await assertNotMergedAway(prisma, input.winnerCustomerId, "Winner");
  }

  const endTime = input.endTime !== undefined ? new Date(input.endTime) : game.endTime;
  if (input.endTime !== undefined && Number.isNaN(endTime!.getTime())) {
    throw ApiError.badRequest("Invalid endTime");
  }
  const endingNow = input.endTime !== undefined && game.endTime === null && endTime !== null;

  let priceOriginal = game.priceOriginal;
  let durationActualMinutes = game.durationActualMinutes;
  let durationBilledMinutes = game.durationBilledMinutes;

  if (endTime !== null && (endingNow || repriceNeeded || input.endTime !== undefined)) {
    const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
    const block = await resolvePricingRule(prisma, table.tableType, gameTypeId, game.startTime);
    const actualMinutes = (endTime.getTime() - game.startTime.getTime()) / 60000;
    if (actualMinutes < 0) throw ApiError.badRequest("endTime cannot be before startTime");

    const billing = computeBilling(
      { blockPrice: block.blockPrice, blockDurationMinutes: block.blockDurationMinutes },
      actualMinutes
    );
    priceOriginal = billing.priceOriginal;
    durationActualMinutes = billing.durationActualMinutes;
    durationBilledMinutes = billing.durationBilledMinutes;
  } else if (repriceNeeded) {
    // Not ended yet, but table/game type changed: refresh the base price
    // (block price only, no overtime yet) against the (possibly new)
    // pricing rule effective at the original start time.
    const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
    const block = await resolvePricingRule(prisma, table.tableType, gameTypeId, game.startTime);
    priceOriginal = block.blockPrice;
  }

  // Discount: unrestricted for any role (decision #3 — no approval gate).
  const discountInputGiven =
    input.discountAmount !== undefined || input.discountPercent !== undefined;
  const discountAmount = discountInputGiven
    ? applyDiscount({
        priceOriginal,
        discountAmount: input.discountAmount,
        discountPercent: input.discountPercent,
      }).discountAmount
    : game.discountAmount;

  let priceFinal = priceOriginal - discountAmount;
  if (input.priceOverride !== undefined) {
    priceFinal = input.priceOverride;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.game.update({
      where: { id: gameId },
      data: {
        tableId,
        gameTypeId,
        endTime: endTime ?? undefined,
        winnerCustomerId:
          input.winnerCustomerId !== undefined ? input.winnerCustomerId : undefined,
        paymentStatus: input.paymentStatus ?? undefined,
        priceOriginal,
        discountAmount,
        discountReason: input.discountReason !== undefined ? input.discountReason : undefined,
        discountById: discountInputGiven ? actor.userId : undefined,
        priceFinal,
        durationActualMinutes: durationActualMinutes ?? undefined,
        durationBilledMinutes: durationBilledMinutes ?? undefined,
      },
    });

    if (endingNow && endTime) {
      await openVacantWindow(tx, tableId, endTime);
    }

    await writeAuditLog(tx, {
      entityType: "game",
      entityId: gameId,
      action: "update",
      performedById: actor.userId,
      beforeValue: before,
      afterValue: result,
    });

    return result;
  });

  return updated;
}

export async function reverseGame(
  prisma: PrismaClient,
  gameId: number,
  reason: string,
  actor: { userId: number; role: string }
): Promise<Game> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw ApiError.notFound(`Game ${gameId} not found`);
  if (game.reversed) throw ApiError.conflict("Game is already reversed");

  // Behavioral requirement #2 / role matrix: receptionist cannot reverse
  // others' entries, but may reverse their own. Owner/manager may reverse any.
  if (actor.role === "receptionist" && game.createdByUserId !== actor.userId) {
    throw ApiError.forbidden("Receptionists may only reverse their own entries");
  }

  const before = { ...game };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.game.update({
      where: { id: gameId },
      data: {
        reversed: true,
        reversedReason: reason,
        reversedById: actor.userId,
        reversedAt: new Date(),
      },
    });

    await writeAuditLog(tx, {
      entityType: "game",
      entityId: gameId,
      action: "reverse",
      performedById: actor.userId,
      beforeValue: before,
      afterValue: result,
    });

    return result;
  });

  return updated;
}
