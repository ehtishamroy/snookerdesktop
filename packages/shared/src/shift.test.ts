import { describe, expect, it } from "vitest";
import { buildZReport } from "./shift";

describe("buildZReport (shift close / cash reconciliation)", () => {
  it("splits totals by payment method so cash and EasyPaisa reconcile separately", () => {
    const report = buildZReport({
      payments: [
        { method: "cash", amount: 1000 },
        { method: "easypaisa", amount: 500 },
        { method: "cash", amount: 200 },
      ],
      expenses: [
        { method: "cash", amount: 300 },
        { method: "easypaisa", amount: 100 },
      ],
      games: [
        { paymentStatus: "paid", discountAmount: 0, priceFinal: 1000 },
        { paymentStatus: "pending", discountAmount: 0, priceFinal: 200 },
        { paymentStatus: "loan", discountAmount: 0, priceFinal: 150 },
        { paymentStatus: "tricked", discountAmount: 0, priceFinal: 100 },
      ],
      declaredCashAmount: 900,
    });

    expect(report.totalsByMethod.cash).toBe(1200);
    expect(report.totalsByMethod.easypaisa).toBe(500);
    // Cash collected (1200) - cash expenses (300) = 900 should be in the drawer.
    expect(report.systemCashTotal).toBe(900);
    expect(report.declaredCashAmount).toBe(900);
    expect(report.cashVariance).toBe(0);
    expect(report.cashVarianceNeedsAttention).toBe(false);
    // Expenses are always paid out of today's club earnings (cash or
    // otherwise), never a separate pool — every method nets its own expenses.
    expect(report.netByMethod.cash).toBe(900);
    expect(report.netByMethod.easypaisa).toBe(400); // 500 collected - 100 expense
    expect(report.totalPendingCreated).toBe(200);
    expect(report.totalLoanCreated).toBe(150);
    expect(report.totalTrickedCount).toBe(1);
  });

  it("flags a cash variance beyond the attention threshold", () => {
    const report = buildZReport({
      payments: [{ method: "cash", amount: 1000 }],
      expenses: [],
      games: [],
      declaredCashAmount: 700,
    });
    expect(report.cashVariance).toBe(-300);
    expect(report.cashVarianceNeedsAttention).toBe(true);
  });
});
