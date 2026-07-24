import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { getBalanceSheet, getFinancialAnalysis, recordPayout, setStartingBalance } from "../services/capitalService";

describe("capitalService (owner-only balance sheet)", () => {
  async function seed(db: ReturnType<typeof createTestDb>) {
    const owner = await db.user.create({ data: { fullName: "Owner", username: "owner", role: "owner", pinHash: "x" } });
    const table = await db.table.create({ data: { tableNumber: 1, tableType: "standard", label: "Table 1" } });
    const gameType = await db.gameType.create({ data: { code: "6_ball", name: "6 Ball", defaultDurationMinutes: 25 } });
    const customer = await db.customer.create({ data: { displayName: "Payer" } });
    const shift = await db.shift.create({ data: { userId: owner.id } });
    return { owner, table, gameType, customer, shift };
  }

  it("derives the balance per method as starting + payments - expenses - payouts, never stored", async () => {
    const db = createTestDb();
    const { owner } = await seed(db);

    await setStartingBalance(db as any, { method: "cash", amount: 5000 }, { userId: owner.id });
    await db.payment.create({ data: { amount: 1000, method: "cash", paidAt: new Date(), collectedByUserId: owner.id, shiftId: 1 } });
    await db.expense.create({ data: { category: "Repair", amount: 200, method: "cash", recordedByUserId: owner.id, shiftId: 1 } });
    await recordPayout(db as any, { amount: 300, method: "cash", note: "Owner draw" }, { userId: owner.id });

    const sheet = await getBalanceSheet(db as any);
    const cash = sheet.byMethod.find((m) => m.method === "cash")!;
    expect(cash.startingAmount).toBe(5000);
    expect(cash.totalCollected).toBe(1000);
    expect(cash.totalExpenses).toBe(200);
    expect(cash.totalPayouts).toBe(300);
    expect(cash.balance).toBe(5000 + 1000 - 200 - 300);

    const easypaisa = sheet.byMethod.find((m) => m.method === "easypaisa")!;
    expect(easypaisa.balance).toBe(0); // never set/touched — stays zero, not undefined/NaN

    expect(sheet.totalCapital).toBe(sheet.byMethod.reduce((sum, m) => sum + m.balance, 0));
  });

  it("updating the starting balance again overwrites it rather than accumulating", async () => {
    const db = createTestDb();
    const { owner } = await seed(db);

    await setStartingBalance(db as any, { method: "cash", amount: 5000 }, { userId: owner.id });
    await setStartingBalance(db as any, { method: "cash", amount: 7000 }, { userId: owner.id });

    const sheet = await getBalanceSheet(db as any);
    expect(sheet.byMethod.find((m) => m.method === "cash")!.startingAmount).toBe(7000);
  });

  it("rejects a non-positive payout", async () => {
    const db = createTestDb();
    const { owner } = await seed(db);
    await expect(recordPayout(db as any, { amount: 0, method: "cash" }, { userId: owner.id })).rejects.toThrow(/positive/);
  });

  it("computes average daily/monthly sale and expense, and a same-month earnings projection", async () => {
    const db = createTestDb();
    const { owner, table, gameType, customer, shift } = await seed(db);

    const now = new Date();
    const earlierThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 10);
    await db.game.create({
      data: {
        localUuid: "g1",
        tableId: table.id,
        gameTypeId: gameType.id,
        startTime: earlierThisMonth,
        endTime: earlierThisMonth,
        priceOriginal: 1000,
        priceFinal: 1000,
        loserCustomerId: customer.id,
        paymentStatus: "paid",
        createdByUserId: owner.id,
        shiftId: shift.id,
      },
    });
    await db.game.create({
      data: {
        localUuid: "g2",
        tableId: table.id,
        gameTypeId: gameType.id,
        startTime: earlierThisMonth,
        endTime: earlierThisMonth,
        priceOriginal: 500,
        priceFinal: 500,
        loserCustomerId: customer.id,
        paymentStatus: "loan",
        createdByUserId: owner.id,
        shiftId: shift.id,
      },
    });
    await db.expense.create({
      data: { category: "Supplies", amount: 100, method: "cash", spentAt: earlierThisMonth, recordedByUserId: owner.id, shiftId: shift.id },
    });

    const analysis = await getFinancialAnalysis(db as any);
    expect(analysis.avgMonthlySale).toBeGreaterThan(0);
    expect(analysis.avgMonthlyExpense).toBeGreaterThan(0);
    expect(analysis.avgMonthlyLoan).toBeGreaterThan(0);
    expect(analysis.currentMonth.salesSoFar).toBe(1500);
    expect(analysis.currentMonth.projectedMonthEndEarning).toBeGreaterThanOrEqual(1500);
  });
});
