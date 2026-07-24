import { PaymentMethod, CASH_VARIANCE_ATTENTION_THRESHOLD } from "./constants";

/**
 * End-of-day cash reconciliation / "close shift" (Z-report). Not in the
 * original brief — owner decision: wanted, and explicitly tied to
 * login/logout (logging out closes the shift; closing the shift logs out).
 *
 * Multiple payment methods are tracked so the receptionist can declare
 * cash-in-hand specifically and compare it against the system's cash total,
 * while EasyPaisa/JazzCash/card totals reconcile against those accounts
 * instead of the physical drawer.
 */

export interface ShiftPayment {
  method: PaymentMethod;
  amount: number;
}

export interface ShiftExpense {
  method: PaymentMethod;
  amount: number;
}

export interface ShiftGameSummary {
  paymentStatus: "paid" | "pending" | "loan" | "collateral" | "tricked";
  discountAmount: number;
  priceFinal: number;
}

export interface ZReportInput {
  payments: ShiftPayment[];
  expenses: ShiftExpense[];
  games: ShiftGameSummary[];
  declaredCashAmount: number;
}

export interface ZReport {
  totalsByMethod: Record<PaymentMethod, number>;
  expensesByMethod: Record<PaymentMethod, number>;
  /** Each method's collected total minus that method's expenses (decision: expenses are always paid out of today's club earnings, cash or otherwise — never a separate pool). Cash's entry equals systemCashTotal. */
  netByMethod: Record<PaymentMethod, number>;
  /** Cash collected minus cash paid out for expenses — what should physically be in the drawer. */
  systemCashTotal: number;
  declaredCashAmount: number;
  cashVariance: number;
  cashVarianceNeedsAttention: boolean;
  totalCollected: number;
  totalDiscountsGiven: number;
  totalPendingCreated: number;
  totalLoanCreated: number;
  totalTrickedCount: number;
  totalCollateralCount: number;
}

const emptyMethodTotals = (): Record<PaymentMethod, number> => ({
  cash: 0,
  easypaisa: 0,
  jazzcash: 0,
  card: 0,
});

export function buildZReport(input: ZReportInput): ZReport {
  const totalsByMethod = emptyMethodTotals();
  for (const p of input.payments) {
    totalsByMethod[p.method] += p.amount;
  }

  const expensesByMethod = emptyMethodTotals();
  for (const e of input.expenses) {
    expensesByMethod[e.method] += e.amount;
  }

  const netByMethod = emptyMethodTotals();
  for (const method of Object.keys(netByMethod) as PaymentMethod[]) {
    netByMethod[method] = totalsByMethod[method] - expensesByMethod[method];
  }

  const systemCashTotal = netByMethod.cash;
  const cashVariance = input.declaredCashAmount - systemCashTotal;

  const totalCollected = Object.values(totalsByMethod).reduce((a, b) => a + b, 0);
  const totalDiscountsGiven = input.games.reduce((sum, g) => sum + g.discountAmount, 0);
  const totalPendingCreated = input.games
    .filter((g) => g.paymentStatus === "pending")
    .reduce((sum, g) => sum + g.priceFinal, 0);
  const totalLoanCreated = input.games
    .filter((g) => g.paymentStatus === "loan")
    .reduce((sum, g) => sum + g.priceFinal, 0);
  const totalTrickedCount = input.games.filter((g) => g.paymentStatus === "tricked").length;
  const totalCollateralCount = input.games.filter((g) => g.paymentStatus === "collateral").length;

  return {
    totalsByMethod,
    expensesByMethod,
    netByMethod,
    systemCashTotal,
    declaredCashAmount: input.declaredCashAmount,
    cashVariance,
    cashVarianceNeedsAttention: Math.abs(cashVariance) >= CASH_VARIANCE_ATTENTION_THRESHOLD,
    totalCollected,
    totalDiscountsGiven,
    totalPendingCreated,
    totalLoanCreated,
    totalTrickedCount,
    totalCollateralCount,
  };
}
