import type { PrismaClient } from "@prisma/client";
import { PAYMENT_METHODS, type PaymentMethod } from "@snooker/shared";
import { ApiError } from "../lib/errors";
import { writeAuditLog } from "../lib/audit";

/**
 * Owner-only balance sheet: one running balance per payment method, always
 * DERIVED rather than stored — startingAmount (the owner's last-declared
 * baseline, see CapitalStartingBalance) plus every settled payment, minus
 * every expense, minus every payout, ever recorded for that method. Nothing
 * here is scoped to a date range; it's the current, all-time balance.
 */
export async function getBalanceSheet(prisma: PrismaClient) {
  const [startingBalances, paymentSums, expenseSums, payoutSums] = await Promise.all([
    prisma.capitalStartingBalance.findMany(),
    prisma.payment.groupBy({ by: ["method"], _sum: { amount: true } }),
    prisma.expense.groupBy({ by: ["method"], _sum: { amount: true } }),
    prisma.payout.groupBy({ by: ["method"], _sum: { amount: true } }),
  ]);

  const startingByMethod = Object.fromEntries(startingBalances.map((r) => [r.method, r.amount])) as Record<
    PaymentMethod,
    number | undefined
  >;
  const paymentsByMethod = Object.fromEntries(paymentSums.map((r) => [r.method, r._sum.amount ?? 0])) as Record<
    PaymentMethod,
    number | undefined
  >;
  const expensesByMethod = Object.fromEntries(expenseSums.map((r) => [r.method, r._sum.amount ?? 0])) as Record<
    PaymentMethod,
    number | undefined
  >;
  const payoutsByMethod = Object.fromEntries(payoutSums.map((r) => [r.method, r._sum.amount ?? 0])) as Record<
    PaymentMethod,
    number | undefined
  >;

  const byMethod = PAYMENT_METHODS.map((method) => {
    const startingAmount = startingByMethod[method] ?? 0;
    const totalCollected = paymentsByMethod[method] ?? 0;
    const totalExpenses = expensesByMethod[method] ?? 0;
    const totalPayouts = payoutsByMethod[method] ?? 0;
    return {
      method,
      startingAmount,
      totalCollected,
      totalExpenses,
      totalPayouts,
      balance: startingAmount + totalCollected - totalExpenses - totalPayouts,
      startingSetAt: startingBalances.find((r) => r.method === method)?.updatedAt.toISOString() ?? null,
    };
  });

  return {
    byMethod,
    totalCapital: byMethod.reduce((sum, m) => sum + m.balance, 0),
  };
}

export async function setStartingBalance(
  prisma: PrismaClient,
  input: { method: PaymentMethod; amount: number },
  actor: { userId: number }
) {
  const before = await prisma.capitalStartingBalance.findUnique({ where: { method: input.method } });

  const after = await prisma.$transaction(async (tx) => {
    const result = await tx.capitalStartingBalance.upsert({
      where: { method: input.method },
      create: { method: input.method, amount: input.amount, updatedById: actor.userId },
      update: { amount: input.amount, updatedById: actor.userId },
    });
    await writeAuditLog(tx, {
      entityType: "capital_starting_balance",
      entityId: 0,
      action: before ? "update" : "create",
      performedById: actor.userId,
      beforeValue: before,
      afterValue: result,
    });
    return result;
  });

  return after;
}

export interface RecordPayoutInput {
  amount: number;
  method: PaymentMethod;
  note?: string;
}

/** Owner drawing money out of capital — subtracts from that method's balance the same way an expense does, tracked separately since it isn't an operating cost. */
export async function recordPayout(prisma: PrismaClient, input: RecordPayoutInput, actor: { userId: number }) {
  if (input.amount <= 0) throw ApiError.badRequest("Payout amount must be positive");

  return prisma.$transaction(async (tx) => {
    const payout = await tx.payout.create({
      data: {
        amount: input.amount,
        method: input.method,
        note: input.note,
        performedById: actor.userId,
      },
    });
    await writeAuditLog(tx, {
      entityType: "payout",
      entityId: payout.id,
      action: "create",
      performedById: actor.userId,
      beforeValue: null,
      afterValue: payout,
    });
    return payout;
  });
}

export async function listPayouts(prisma: PrismaClient, opts: { from?: Date; to?: Date }) {
  return prisma.payout.findMany({
    where: {
      ...(opts.from || opts.to
        ? {
            performedAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: { performedBy: { select: { id: true, fullName: true } } },
    orderBy: { performedAt: "desc" },
    take: 200,
  });
}

/**
 * "Detailed analysis" (owner-only): daily/monthly averages for sale and
 * expense, average daily loan (udhaar) created, and a same-month earnings
 * projection — none of this is a date-range report like getRevenueReport,
 * it's always computed from a fixed lookback ending "now" so the owner gets
 * one consistent answer to "how are we doing" without picking a range.
 */
export async function getFinancialAnalysis(prisma: PrismaClient, opts: { monthsLookback?: number } = {}) {
  const monthsLookback = opts.monthsLookback ?? 6;
  const now = new Date();
  const lookbackStart = new Date(now.getFullYear(), now.getMonth() - monthsLookback, 1);

  const games = await prisma.game.findMany({
    where: { reversed: false, endTime: { not: null }, startTime: { gte: lookbackStart, lte: now } },
    select: { startTime: true, priceFinal: true, paymentStatus: true },
  });
  const expenses = await prisma.expense.findMany({
    where: { spentAt: { gte: lookbackStart, lte: now } },
    select: { spentAt: true, amount: true },
  });

  // Bucket by calendar month (yyyy-MM) for the "average monthly" figures.
  const salesByMonth = new Map<string, number>();
  const loanByMonth = new Map<string, number>();
  for (const g of games) {
    const key = `${g.startTime.getFullYear()}-${g.startTime.getMonth()}`;
    salesByMonth.set(key, (salesByMonth.get(key) ?? 0) + g.priceFinal);
    if (g.paymentStatus === "loan") {
      loanByMonth.set(key, (loanByMonth.get(key) ?? 0) + g.priceFinal);
    }
  }
  const expensesByMonth = new Map<string, number>();
  for (const e of expenses) {
    const key = `${e.spentAt.getFullYear()}-${e.spentAt.getMonth()}`;
    expensesByMonth.set(key, (expensesByMonth.get(key) ?? 0) + e.amount);
  }

  const avg = (m: Map<string, number>) => (m.size === 0 ? 0 : Math.round([...m.values()].reduce((a, b) => a + b, 0) / m.size));

  const totalDays = Math.max(1, Math.ceil((now.getTime() - lookbackStart.getTime()) / (24 * 60 * 60 * 1000)));
  const totalSales = games.reduce((sum, g) => sum + g.priceFinal, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const totalLoan = games.filter((g) => g.paymentStatus === "loan").reduce((sum, g) => sum + g.priceFinal, 0);

  // Same-month projection: this month's daily average so far, extrapolated
  // across the full month — not a lookback average, since the owner asked
  // specifically for "expected earning at the end of the month" (i.e. this
  // month, in progress).
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysElapsedThisMonth = Math.max(1, now.getDate());
  const daysInThisMonth = monthEnd.getDate();
  const thisMonthSales = games
    .filter((g) => g.startTime >= monthStart)
    .reduce((sum, g) => sum + g.priceFinal, 0);
  const projectedMonthEndEarning = Math.round((thisMonthSales / daysElapsedThisMonth) * daysInThisMonth);

  return {
    lookbackMonths: monthsLookback,
    avgDailySale: Math.round(totalSales / totalDays),
    avgDailyExpense: Math.round(totalExpenses / totalDays),
    avgDailyLoan: Math.round(totalLoan / totalDays),
    avgMonthlySale: avg(salesByMonth),
    avgMonthlyExpense: avg(expensesByMonth),
    avgMonthlyLoan: avg(loanByMonth),
    currentMonth: {
      salesSoFar: thisMonthSales,
      daysElapsed: daysElapsedThisMonth,
      daysInMonth: daysInThisMonth,
      projectedMonthEndEarning,
    },
  };
}
