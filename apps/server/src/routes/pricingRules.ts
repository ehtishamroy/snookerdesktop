import { Router } from "express";
import { z } from "zod";
import { TABLE_TYPES } from "@snooker/shared";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/errors";
import { createPricingRule } from "../services/pricingService";

export const pricingRulesRouter = Router();
pricingRulesRouter.use(requireAuth);

pricingRulesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.activeOnly === "true" || req.query.activeOnly === undefined;
    const rules = await prisma.pricingRule.findMany({
      where: activeOnly ? { effectiveTo: null } : {},
      include: { gameType: true },
      orderBy: [{ tableType: "asc" }, { gameTypeId: "asc" }],
    });
    res.json(rules);
  })
);

pricingRulesRouter.get(
  "/history",
  asyncHandler(async (req, res) => {
    const tableType = req.query.tableType as string | undefined;
    const gameTypeId = req.query.gameTypeId ? Number(req.query.gameTypeId) : undefined;

    const rules = await prisma.pricingRule.findMany({
      where: {
        ...(tableType ? { tableType: tableType as any } : {}),
        ...(gameTypeId !== undefined ? { gameTypeId } : {}),
      },
      include: { gameType: true },
      orderBy: { effectiveFrom: "desc" },
    });
    res.json(rules);
  })
);

const createPricingRuleSchema = z.object({
  tableType: z.enum(TABLE_TYPES),
  gameTypeId: z.number().int().positive(),
  price: z.number().int().positive(),
  durationMinutes: z.number().int().positive(),
});

/**
 * Owner only, per API_CONTRACT.md ("POST /pricing-rules (owner only)") and
 * the role matrix (manager cannot edit pricing).
 */
pricingRulesRouter.post(
  "/",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const body = createPricingRuleSchema.parse(req.body);

    const gameType = await prisma.gameType.findUnique({ where: { id: body.gameTypeId } });
    if (!gameType) throw ApiError.badRequest(`Game type ${body.gameTypeId} does not exist`);

    const created = await createPricingRule(prisma, body, req.user!.userId);
    res.status(201).json(created);
  })
);
