/**
 * The "losing chain" ledger: a player can lose repeatedly, across tables and
 * hours, before ever settling up. Each round is its own record; this module
 * aggregates a customer's (or nishani's) unpaid rounds into one settle-up
 * view, and supports settling any subset of them (partial settlement).
 */

export type UnsettledPaymentStatus = "pending" | "loan" | "collateral" | "tricked";

export interface LedgerGame {
  gameId: number;
  tableNumber: number;
  gameTypeName: string;
  startTime: Date;
  endTime: Date;
  priceFinal: number;
  paymentStatus: UnsettledPaymentStatus;
}

export interface CustomerLedgerSummary {
  customerId: number;
  unsettledGames: LedgerGame[];
  totalOwed: number;
  /** First round's start time across all unsettled rounds, or null if none. */
  spanStart: Date | null;
  /** Last round's end time across all unsettled rounds, or null if none. */
  spanEnd: Date | null;
  spanMinutes: number;
}

export function buildCustomerLedger(customerId: number, games: LedgerGame[]): CustomerLedgerSummary {
  if (games.length === 0) {
    return {
      customerId,
      unsettledGames: [],
      totalOwed: 0,
      spanStart: null,
      spanEnd: null,
      spanMinutes: 0,
    };
  }

  const sorted = [...games].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const spanStart = sorted[0]!.startTime;
  const spanEnd = sorted.reduce(
    (latest, g) => (g.endTime.getTime() > latest.getTime() ? g.endTime : latest),
    sorted[0]!.endTime
  );

  const totalOwed = games.reduce((sum, g) => sum + g.priceFinal, 0);

  return {
    customerId,
    unsettledGames: sorted,
    totalOwed,
    spanStart,
    spanEnd,
    spanMinutes: (spanEnd.getTime() - spanStart.getTime()) / 60000,
  };
}

export interface SettlementSelection {
  selectedGameIds: number[];
  amount: number;
  method: string;
}

/** Validates that a settlement only touches games that are actually still unsettled. */
export function validateSettlement(
  ledger: CustomerLedgerSummary,
  selection: SettlementSelection
): { valid: boolean; error?: string } {
  const unsettledIds = new Set(ledger.unsettledGames.map((g) => g.gameId));
  for (const id of selection.selectedGameIds) {
    if (!unsettledIds.has(id)) {
      return { valid: false, error: `Game ${id} is not an unsettled round for this customer` };
    }
  }
  if (selection.selectedGameIds.length === 0) {
    return { valid: false, error: "No rounds selected" };
  }
  return { valid: true };
}
