import { Router } from "express";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { purgeNishani } from "../jobs/purgeNishani";

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

/**
 * Manual trigger for the nishani purge job (behavioral requirement #9),
 * owner only per API_CONTRACT.md's "Background jobs" section. Useful for
 * testing/QA and for the owner to force a purge without waiting for the
 * next cron tick.
 */
jobsRouter.post(
  "/purge-nishani",
  requireRole("owner"),
  asyncHandler(async (_req, res) => {
    const result = await purgeNishani(prisma);
    res.json(result);
  })
);
