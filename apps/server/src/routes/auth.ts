import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { signToken } from "../auth/jwt";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/errors";
import { closeOpenShiftForLogout } from "../services/shiftService";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  pin: z.string().min(1),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { username: body.username } });
    if (!user || !user.isActive) {
      throw ApiError.unauthorized("Invalid username or PIN");
    }

    const matches = await bcrypt.compare(body.pin, user.pinHash);
    if (!matches) {
      throw ApiError.unauthorized("Invalid username or PIN");
    }

    const token = signToken({
      userId: user.id,
      role: user.role,
      fullName: user.fullName,
      username: user.username,
    });

    res.json({
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        role: user.role,
        isActive: user.isActive,
      },
    });
  })
);

const logoutSchema = z.object({
  declaredCashAmount: z.number().int().nonnegative().optional(),
});

/**
 * Behavioral requirement #1 / decision #5: logout and shift-close are the
 * same action. This force-closes the caller's open shift (if any) using
 * whatever declaredCashAmount was supplied — falling back to the shift's
 * own computed systemCashTotal when none is given (see shiftService's
 * closeOpenShiftForLogout for the documented fallback rationale).
 */
authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = logoutSchema.parse(req.body ?? {});
    const result = await closeOpenShiftForLogout(prisma, req.user!.userId, body.declaredCashAmount);

    res.json({
      message: "Logged out",
      shiftClosed: result !== null,
      shift: result?.shift ?? null,
      zReport: result?.zReport ?? null,
    });
  })
);
