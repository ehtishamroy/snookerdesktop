import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { ROLES } from "@snooker/shared";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/errors";
import { writeAuditLog } from "../lib/audit";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const BCRYPT_ROUNDS = 10;

function serializeUser(u: { id: number; fullName: string; username: string; role: string; isActive: boolean; createdAt: Date }) {
  return { id: u.id, fullName: u.fullName, username: u.username, role: u.role, isActive: u.isActive, createdAt: u.createdAt };
}

/**
 * Role note: viewing the staff list is allowed for owner + manager (a
 * manager needs it to attribute/compare staff activity); receptionist has
 * no legitimate need to see other staff accounts and is blocked, matching
 * "receptionist cannot ... manage staff" in spirit even for read access.
 */
usersRouter.get(
  "/",
  requireRole("owner", "manager"),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: { fullName: "asc" } });
    res.json(users.map(serializeUser));
  })
);

const createUserSchema = z.object({
  fullName: z.string().min(1),
  username: z.string().min(1),
  role: z.enum(ROLES),
  pin: z.string().min(4).max(12),
});

usersRouter.post(
  "/",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { username: body.username } });
    if (existing) throw ApiError.conflict(`Username "${body.username}" is already taken`);

    const pinHash = await bcrypt.hash(body.pin, BCRYPT_ROUNDS);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { fullName: body.fullName, username: body.username, role: body.role, pinHash },
      });
      await writeAuditLog(tx, {
        entityType: "user",
        entityId: user.id,
        action: "create",
        performedById: req.user!.userId,
        beforeValue: null,
        afterValue: serializeUser(user),
      });
      return user;
    });

    res.status(201).json(serializeUser(created));
  })
);

const patchUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  pin: z.string().min(4).max(12).optional(),
});

usersRouter.patch(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = patchUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound(`User ${id} not found`);

    const data: Record<string, unknown> = {};
    if (body.fullName !== undefined) data.fullName = body.fullName;
    if (body.role !== undefined) data.role = body.role;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.pin !== undefined) data.pinHash = await bcrypt.hash(body.pin, BCRYPT_ROUNDS);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({ where: { id }, data });
      await writeAuditLog(tx, {
        entityType: "user",
        entityId: id,
        action: "update",
        performedById: req.user!.userId,
        beforeValue: serializeUser(existing),
        afterValue: serializeUser(result),
      });
      return result;
    });

    res.json(serializeUser(updated));
  })
);
