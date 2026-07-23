import { Router } from "express";
import { z } from "zod";
import { PAYMENT_STATUSES } from "@snooker/shared";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/errors";
import { createGame, reverseGame, updateGame } from "../services/gameService";

export const gamesRouter = Router();
gamesRouter.use(requireAuth);

gamesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tableId, customerId, from, to, paymentStatus, reversed } = req.query;

    const where: Record<string, unknown> = {};
    if (tableId) where.tableId = Number(tableId);
    if (customerId) where.loserCustomerId = Number(customerId);
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (reversed !== undefined) where.reversed = reversed === "true";
    if (from || to) {
      where.startTime = {
        ...(from ? { gte: new Date(String(from)) } : {}),
        ...(to ? { lte: new Date(String(to)) } : {}),
      };
    }

    // Role scoping: a receptionist only sees their own shift's activity in
    // aggregate reports (role matrix §6) — but the operational games list
    // (used to run the counter / settle a customer's tab regardless of who
    // rang it in) is not restricted per-row here; only the analytical
    // reports under /reports/* are role-scoped. See README.md for the full
    // rationale.

    const games = await prisma.game.findMany({
      where,
      include: {
        table: true,
        gameType: true,
        loserCustomer: true,
        winnerCustomer: true,
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { startTime: "desc" },
      take: 500,
    });

    res.json(games);
  })
);

const createGameSchema = z.object({
  localUuid: z.string().min(1),
  tableId: z.number().int().positive(),
  gameTypeId: z.number().int().positive(),
  startTime: z.string().min(1),
  loserCustomerId: z.number().int().positive(),
  winnerCustomerId: z.number().int().positive().optional().nullable(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  discountAmount: z.number().nonnegative().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountReason: z.string().optional(),
});

gamesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createGameSchema.parse(req.body);
    const created = await createGame(prisma, body, req.user!.userId);
    res.status(201).json(created);
  })
);

const updateGameSchema = z.object({
  endTime: z.string().min(1).optional(),
  tableId: z.number().int().positive().optional(),
  gameTypeId: z.number().int().positive().optional(),
  winnerCustomerId: z.number().int().positive().optional().nullable(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  discountAmount: z.number().nonnegative().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountReason: z.string().optional(),
  priceOverride: z.number().int().nonnegative().optional(),
});

gamesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = updateGameSchema.parse(req.body);
    const updated = await updateGame(prisma, id, body, req.user!);
    res.json(updated);
  })
);

const reverseSchema = z.object({
  reason: z.string().min(1),
});

gamesRouter.post(
  "/:id/reverse",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = reverseSchema.parse(req.body);
    if (Number.isNaN(id)) throw ApiError.badRequest("Invalid game id");
    const reversed = await reverseGame(prisma, id, body.reason, req.user!);
    res.json(reversed);
  })
);
