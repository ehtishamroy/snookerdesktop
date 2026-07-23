import { Router } from "express";
import { z } from "zod";
import { PAYMENT_METHODS } from "@snooker/shared";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { settlePayment } from "../services/ledgerService";

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const createPaymentSchema = z.object({
  customerId: z.number().int().positive(),
  amount: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS),
  note: z.string().optional(),
  gameIds: z.array(z.number().int().positive()).min(1),
});

paymentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createPaymentSchema.parse(req.body);
    const payment = await settlePayment(prisma, body, req.user!);
    res.status(201).json(payment);
  })
);
