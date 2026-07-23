import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/errors";
import {
  createCustomer,
  createNishani,
  mergeCustomers,
  searchCustomers,
} from "../services/customerService";
import { getCustomerLedger, getLoanLedgerOverview } from "../services/ledgerService";

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const customers = await searchCustomers(prisma, search);
    res.json(customers);
  })
);

/**
 * GET /customers/loan-ledger — owner/manager view of every customer with an
 * outstanding balance, per API_CONTRACT.md. Must be registered before the
 * `/:id/ledger` route below so Express doesn't try to parse "loan-ledger" as
 * a numeric id.
 */
customersRouter.get(
  "/loan-ledger",
  requireRole("owner", "manager"),
  asyncHandler(async (_req, res) => {
    const overview = await getLoanLedgerOverview(prisma);
    res.json(overview);
  })
);

customersRouter.get(
  "/:id/ledger",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const ledger = await getCustomerLedger(prisma, id);
    res.json(ledger);
  })
);

const createCustomerSchema = z.object({
  displayName: z.string().min(1),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

customersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createCustomerSchema.parse(req.body);
    const created = await createCustomer(prisma, body, req.user!.userId);
    res.status(201).json(created);
  })
);

const createNishaniSchema = z.object({
  nishaniDescription: z.string().min(1),
});

customersRouter.post(
  "/nishani",
  asyncHandler(async (req, res) => {
    const body = createNishaniSchema.parse(req.body);
    const created = await createNishani(prisma, body.nishaniDescription, req.user!.userId);
    res.status(201).json(created);
  })
);

const mergeSchema = z.object({
  intoCustomerId: z.number().int().positive(),
});

customersRouter.post(
  "/:id/merge",
  requireRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = mergeSchema.parse(req.body);
    const merged = await mergeCustomers(prisma, id, body.intoCustomerId, req.user!.userId);
    res.json(merged);
  })
);
