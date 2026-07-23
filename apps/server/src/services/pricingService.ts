import type { Prisma, PrismaClient, TableType } from "@prisma/client";
import { ApiError } from "../lib/errors";
import { writeAuditLog, type Db } from "../lib/audit";

export interface ResolvedBlock {
  ruleId: number;
  blockPrice: number;
  blockDurationMinutes: number;
}

/**
 * Behavioral requirement #5: pricing resolution for a game always means the
 * pricing_rules row whose `effective_from <= at` and
 * `(effective_to IS NULL OR effective_to > at)`, scoped by
 * (tableType, gameTypeId). This is what makes historical reports show the
 * price that applied when a round was actually played, even after the
 * owner changes prices later (decision #2).
 */
export async function resolvePricingRule(
  db: Db,
  tableType: TableType,
  gameTypeId: number,
  at: Date
): Promise<ResolvedBlock> {
  const rule = await db.pricingRule.findFirst({
    where: {
      tableType,
      gameTypeId,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });

  if (!rule) {
    throw ApiError.badRequest(
      `No pricing rule is effective for tableType=${tableType}, gameTypeId=${gameTypeId} at ${at.toISOString()}`
    );
  }

  return { ruleId: rule.id, blockPrice: rule.price, blockDurationMinutes: rule.durationMinutes };
}

/**
 * POST /pricing-rules (owner only): closes the currently-active rule for
 * this (tableType, gameTypeId) — if one exists — and inserts a new one
 * effective now. Old rows are never edited in place, only closed via
 * `effectiveTo`, so every historical game keeps resolving to the rule that
 * was active when it was played.
 */
export async function createPricingRule(
  prisma: PrismaClient,
  input: {
    tableType: TableType;
    gameTypeId: number;
    price: number;
    durationMinutes: number;
  },
  performedById: number
) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const currentActive = await tx.pricingRule.findFirst({
      where: { tableType: input.tableType, gameTypeId: input.gameTypeId, effectiveTo: null },
    });

    if (currentActive) {
      await tx.pricingRule.update({
        where: { id: currentActive.id },
        data: { effectiveTo: now },
      });
    }

    const created = await tx.pricingRule.create({
      data: {
        tableType: input.tableType,
        gameTypeId: input.gameTypeId,
        price: input.price,
        durationMinutes: input.durationMinutes,
        effectiveFrom: now,
        effectiveTo: null,
        createdById: performedById,
      },
    });

    await writeAuditLog(tx, {
      entityType: "pricing_rule",
      entityId: created.id,
      action: "create",
      performedById,
      beforeValue: currentActive
        ? { id: currentActive.id, price: currentActive.price, effectiveTo: null }
        : null,
      afterValue: created,
    });

    return created;
  });
}
