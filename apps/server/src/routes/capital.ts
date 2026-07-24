import { Router } from "express";
import { z } from "zod";
import { PAYMENT_METHODS } from "@snooker/shared";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { resolveDateRange } from "../services/reportService";
import { getBalanceSheet, getFinancialAnalysis, listPayouts, recordPayout, setStartingBalance } from "../services/capitalService";

/** Everything here is owner-only — capital and monthly earning are explicitly not for staff to see. */
export const capitalRouter = Router();
capitalRouter.use(requireAuth, requireRole("owner"));

capitalRouter.get(
  "/balance-sheet",
  asyncHandler(async (_req, res) => {
    const sheet = await getBalanceSheet(prisma);
    res.json(sheet);
  })
);

const startingBalanceSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().int().nonnegative(),
});

capitalRouter.put(
  "/starting-balance",
  asyncHandler(async (req, res) => {
    const body = startingBalanceSchema.parse(req.body);
    const result = await setStartingBalance(prisma, body, { userId: req.user!.userId });
    res.json(result);
  })
);

const payoutSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS),
  note: z.string().optional(),
});

capitalRouter.post(
  "/payouts",
  asyncHandler(async (req, res) => {
    const body = payoutSchema.parse(req.body);
    const result = await recordPayout(prisma, body, { userId: req.user!.userId });
    res.status(201).json(result);
  })
);

capitalRouter.get(
  "/payouts",
  asyncHandler(async (req, res) => {
    const { from, to } = resolveDateRange(req.query.from as string | undefined, req.query.to as string | undefined);
    const rows = await listPayouts(prisma, { from, to });
    res.json(rows);
  })
);

capitalRouter.get(
  "/analysis",
  asyncHandler(async (req, res) => {
    const monthsLookback = req.query.monthsLookback ? Number(req.query.monthsLookback) : undefined;
    const analysis = await getFinancialAnalysis(prisma, { monthsLookback });
    res.json(analysis);
  })
);
