import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { createCollateralItem, returnCollateralItem } from "../services/collateralService";

export const collateralRouter = Router();
collateralRouter.use(requireAuth);

const createCollateralSchema = z.object({
  gameId: z.number().int().positive(),
  customerId: z.number().int().positive(),
  itemDescription: z.string().min(1),
});

collateralRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createCollateralSchema.parse(req.body);
    const created = await createCollateralItem(prisma, body, req.user!.userId);
    res.status(201).json(created);
  })
);

collateralRouter.post(
  "/:id/return",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const returned = await returnCollateralItem(prisma, id, req.user!.userId);
    res.json(returned);
  })
);
