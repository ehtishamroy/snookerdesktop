import type { Customer, PrismaClient } from "@prisma/client";
import { ApiError } from "../lib/errors";
import { writeAuditLog } from "../lib/audit";

/**
 * Behavioral requirement #8: autosuggest excludes is_temporary=true
 * customers that haven't been merged into a real identity (decision #17 —
 * nishani are never recognizable by name later, so surfacing them in the
 * normal search would just confuse the receptionist).
 */
export async function searchCustomers(prisma: PrismaClient, search: string | undefined) {
  return prisma.customer.findMany({
    where: {
      mergedIntoCustomerId: null,
      OR: [{ isTemporary: false }],
      ...(search
        ? {
            displayName: { contains: search, mode: "insensitive" },
          }
        : {}),
    },
    orderBy: { displayName: "asc" },
    take: 50,
  });
}

export async function createCustomer(
  prisma: PrismaClient,
  input: { displayName: string; phone?: string; notes?: string },
  actorId: number
): Promise<Customer> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: { displayName: input.displayName, phone: input.phone, notes: input.notes },
    });
    await writeAuditLog(tx, {
      entityType: "customer",
      entityId: created.id,
      action: "create",
      performedById: actorId,
      beforeValue: null,
      afterValue: created,
    });
    return created;
  });
}

export async function createNishani(
  prisma: PrismaClient,
  nishaniDescription: string,
  actorId: number
): Promise<Customer> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        displayName: `Nishani: ${nishaniDescription}`,
        isTemporary: true,
        nishaniDescription,
      },
    });
    await writeAuditLog(tx, {
      entityType: "customer",
      entityId: created.id,
      action: "create",
      performedById: actorId,
      beforeValue: null,
      afterValue: created,
    });
    return created;
  });
}

/**
 * POST /customers/:id/merge — re-points all games/payments/collateral from
 * `fromCustomerId` to `intoCustomerId`, marks the source as merged, and
 * keeps its full history (never duplicates). Behavioral requirement per
 * decision #17's merge tool.
 */
export async function mergeCustomers(
  prisma: PrismaClient,
  fromCustomerId: number,
  intoCustomerId: number,
  actorId: number
): Promise<Customer> {
  if (fromCustomerId === intoCustomerId) {
    throw ApiError.badRequest("Cannot merge a customer into itself");
  }

  const [from, into] = await Promise.all([
    prisma.customer.findUnique({ where: { id: fromCustomerId } }),
    prisma.customer.findUnique({ where: { id: intoCustomerId } }),
  ]);
  if (!from) throw ApiError.notFound(`Customer ${fromCustomerId} not found`);
  if (!into) throw ApiError.notFound(`Customer ${intoCustomerId} not found`);
  if (from.mergedIntoCustomerId !== null) {
    throw ApiError.conflict(`Customer ${fromCustomerId} was already merged into ${from.mergedIntoCustomerId}`);
  }
  if (into.mergedIntoCustomerId !== null) {
    throw ApiError.conflict(`Target customer ${intoCustomerId} has itself been merged into ${into.mergedIntoCustomerId}; merge into that id instead`);
  }

  const before = { ...from };

  const updated = await prisma.$transaction(async (tx) => {
    await tx.game.updateMany({
      where: { loserCustomerId: fromCustomerId },
      data: { loserCustomerId: intoCustomerId },
    });
    await tx.game.updateMany({
      where: { winnerCustomerId: fromCustomerId },
      data: { winnerCustomerId: intoCustomerId },
    });
    await tx.payment.updateMany({
      where: { customerId: fromCustomerId },
      data: { customerId: intoCustomerId },
    });
    await tx.collateralItem.updateMany({
      where: { customerId: fromCustomerId },
      data: { customerId: intoCustomerId },
    });

    const result = await tx.customer.update({
      where: { id: fromCustomerId },
      data: { mergedIntoCustomerId: intoCustomerId },
    });

    await writeAuditLog(tx, {
      entityType: "customer",
      entityId: fromCustomerId,
      action: "merge",
      performedById: actorId,
      beforeValue: before,
      afterValue: { ...result, mergedInto: intoCustomerId },
    });

    return result;
  });

  return updated;
}
