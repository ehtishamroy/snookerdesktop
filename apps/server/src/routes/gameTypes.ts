import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";

export const gameTypesRouter = Router();
gameTypesRouter.use(requireAuth);

gameTypesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const gameTypes = await prisma.gameType.findMany({ orderBy: { id: "asc" } });
    res.json(gameTypes);
  })
);
