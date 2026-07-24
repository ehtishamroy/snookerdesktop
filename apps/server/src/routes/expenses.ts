import { Router } from "express";
import { z } from "zod";
import { PAYMENT_METHODS } from "@snooker/shared";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/errors";
import { writeAuditLog } from "../lib/audit";

export const expensesRouter = Router();
expensesRouter.use(requireAuth);

const createExpenseSchema = z.object({
  category: z.string().min(1),
  amount: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS),
  note: z.string().optional(),
});

expensesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createExpenseSchema.parse(req.body);

    const shift = await prisma.shift.findFirst({ where: { userId: req.user!.userId, closedAt: null } });
    if (!shift) throw ApiError.badRequest("You must open a shift before recording an expense");

    const created = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          category: body.category,
          amount: body.amount,
          method: body.method,
          note: body.note,
          recordedByUserId: req.user!.userId,
          shiftId: shift.id,
        },
      });
      await writeAuditLog(tx, {
        entityType: "expense",
        entityId: expense.id,
        action: "create",
        performedById: req.user!.userId,
        beforeValue: null,
        afterValue: expense,
      });
      return expense;
    });

    res.status(201).json(created);
  })
);

const updateExpenseSchema = z.object({
  category: z.string().min(1).optional(),
  amount: z.number().int().positive().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  note: z.string().optional(),
});

/**
 * Any authenticated staff member can correct an expense after the fact
 * (decision #3's "unrestricted but always attributed" philosophy, extended
 * to expense corrections) — but every edit sets `edited`/`editedAt`/
 * `editedById` so it's visibly flagged, on top of the full before/after this
 * still writes to audit_log like any other mutation.
 */
expensesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = updateExpenseSchema.parse(req.body);

    const before = await prisma.expense.findUnique({ where: { id } });
    if (!before) throw ApiError.notFound(`Expense ${id} not found`);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.expense.update({
        where: { id },
        data: {
          category: body.category,
          amount: body.amount,
          method: body.method,
          note: body.note,
          edited: true,
          editedAt: new Date(),
          editedById: req.user!.userId,
        },
      });
      await writeAuditLog(tx, {
        entityType: "expense",
        entityId: id,
        action: "update",
        performedById: req.user!.userId,
        beforeValue: before,
        afterValue: result,
      });
      return result;
    });

    res.json(updated);
  })
);

expensesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to, shiftId } = req.query;

    const where: Record<string, unknown> = {};
    if (shiftId) where.shiftId = Number(shiftId);
    if (from || to) {
      where.spentAt = {
        ...(from ? { gte: new Date(String(from)) } : {}),
        ...(to ? { lte: new Date(String(to)) } : {}),
      };
    }

    // Role scoping: receptionist only sees expenses recorded on their own
    // shifts (financial oversight beyond that belongs to owner/manager).
    if (req.user!.role === "receptionist") {
      where.recordedByUserId = req.user!.userId;
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: { recordedBy: { select: { id: true, fullName: true } } },
      orderBy: { spentAt: "desc" },
      take: 500,
    });
    res.json(expenses);
  })
);
