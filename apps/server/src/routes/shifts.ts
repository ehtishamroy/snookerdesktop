import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/errors";
import { closeShift, getZReport, openShift } from "../services/shiftService";

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

shiftsRouter.post(
  "/open",
  asyncHandler(async (req, res) => {
    const shift = await openShift(prisma, req.user!.userId);
    res.status(201).json(shift);
  })
);

const closeSchema = z.object({
  declaredCashAmount: z.number().int().nonnegative(),
});

shiftsRouter.post(
  "/:id/close",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = closeSchema.parse(req.body);
    const result = await closeShift(prisma, id, body.declaredCashAmount, req.user!);
    res.json({ shift: result.shift, zReport: result.zReport });
  })
);

shiftsRouter.get(
  "/:id/z-report",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const shift = await prisma.shift.findUnique({ where: { id } });
    if (!shift) throw ApiError.notFound(`Shift ${id} not found`);

    // Role scoping: receptionist may only view their own shift's totals
    // (role matrix §6 — "receptionist only sees their own shift totals").
    if (req.user!.role === "receptionist" && shift.userId !== req.user!.userId) {
      throw ApiError.forbidden("Receptionists may only view their own shift's Z-report");
    }

    const result = await getZReport(prisma, id);
    res.json(result);
  })
);

shiftsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { userId, from, to } = req.query;

    const where: Record<string, unknown> = {};
    // Role scoping (behavioral requirement #2): receptionist is forced to
    // their own shifts regardless of a requested userId; owner/manager may
    // query any staff member's attendance/cash-reconciliation history.
    if (req.user!.role === "receptionist") {
      where.userId = req.user!.userId;
    } else if (userId) {
      where.userId = Number(userId);
    }
    if (from || to) {
      where.openedAt = {
        ...(from ? { gte: new Date(String(from)) } : {}),
        ...(to ? { lte: new Date(String(to)) } : {}),
      };
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, username: true, role: true } } },
      orderBy: { openedAt: "desc" },
      take: 500,
    });
    res.json(shifts);
  })
);
