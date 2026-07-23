import type { CollateralItem, PrismaClient } from "@prisma/client";
import { ApiError } from "../lib/errors";
import { writeAuditLog } from "../lib/audit";

export async function createCollateralItem(
  prisma: PrismaClient,
  input: { gameId: number; customerId: number; itemDescription: string },
  actorId: number
): Promise<CollateralItem> {
  const game = await prisma.game.findUnique({ where: { id: input.gameId } });
  if (!game) throw ApiError.badRequest(`Game ${input.gameId} does not exist`);
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw ApiError.badRequest(`Customer ${input.customerId} does not exist`);

  return prisma.$transaction(async (tx) => {
    const created = await tx.collateralItem.create({
      data: {
        gameId: input.gameId,
        customerId: input.customerId,
        itemDescription: input.itemDescription,
        heldByUserId: actorId,
      },
    });

    // Leaving an item as collateral is itself a statement about how this
    // round will be settled — reflect that on the game's paymentStatus so
    // the customer ledger picks it up, unless it's already been paid.
    if (game.paymentStatus !== "paid") {
      const beforeGame = { ...game };
      const afterGame = await tx.game.update({
        where: { id: input.gameId },
        data: { paymentStatus: "collateral" },
      });
      await writeAuditLog(tx, {
        entityType: "game",
        entityId: input.gameId,
        action: "update",
        performedById: actorId,
        beforeValue: beforeGame,
        afterValue: afterGame,
      });
    }

    await writeAuditLog(tx, {
      entityType: "collateral_item",
      entityId: created.id,
      action: "create",
      performedById: actorId,
      beforeValue: null,
      afterValue: created,
    });

    return created;
  });
}

export async function returnCollateralItem(
  prisma: PrismaClient,
  id: number,
  actorId: number
): Promise<CollateralItem> {
  const item = await prisma.collateralItem.findUnique({ where: { id } });
  if (!item) throw ApiError.notFound(`Collateral item ${id} not found`);
  if (item.returned) throw ApiError.conflict("Collateral item was already returned");

  const before = { ...item };

  return prisma.$transaction(async (tx) => {
    const result = await tx.collateralItem.update({
      where: { id },
      data: { returned: true, returnedAt: new Date(), returnedByUserId: actorId },
    });

    await writeAuditLog(tx, {
      entityType: "collateral_item",
      entityId: id,
      action: "return_collateral",
      performedById: actorId,
      beforeValue: before,
      afterValue: result,
    });

    return result;
  });
}
