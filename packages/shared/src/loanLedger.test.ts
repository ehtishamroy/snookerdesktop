import { describe, expect, it } from "vitest";
import { buildCustomerLedger, validateSettlement } from "./loanLedger";

const g = (id: number, start: string, end: string, price: number) => ({
  gameId: id,
  tableNumber: 1,
  gameTypeName: "6 Ball",
  startTime: new Date(start),
  endTime: new Date(end),
  priceFinal: price,
  paymentStatus: "pending" as const,
});

describe("buildCustomerLedger (losing chain scenario)", () => {
  it("aggregates total owed and time span across many rounds, possibly hours apart", () => {
    const ledger = buildCustomerLedger(1, [
      g(1, "2026-07-23T14:00:00Z", "2026-07-23T14:25:00Z", 100),
      g(2, "2026-07-23T18:00:00Z", "2026-07-23T18:30:00Z", 150),
      g(3, "2026-07-23T20:10:00Z", "2026-07-23T20:35:00Z", 100),
    ]);

    expect(ledger.totalOwed).toBe(350);
    expect(ledger.spanStart?.toISOString()).toBe("2026-07-23T14:00:00.000Z");
    expect(ledger.spanEnd?.toISOString()).toBe("2026-07-23T20:35:00.000Z");
    expect(ledger.spanMinutes).toBeCloseTo(395, 5);
    expect(ledger.unsettledGames).toHaveLength(3);
  });

  it("returns an empty summary for a customer with nothing owed", () => {
    const ledger = buildCustomerLedger(2, []);
    expect(ledger.totalOwed).toBe(0);
    expect(ledger.spanStart).toBeNull();
  });
});

describe("validateSettlement (partial settlement)", () => {
  it("allows settling a subset of unsettled rounds", () => {
    const ledger = buildCustomerLedger(1, [
      g(1, "2026-07-23T14:00:00Z", "2026-07-23T14:25:00Z", 100),
      g(2, "2026-07-23T18:00:00Z", "2026-07-23T18:30:00Z", 150),
    ]);
    const result = validateSettlement(ledger, { selectedGameIds: [1], amount: 100, method: "cash" });
    expect(result.valid).toBe(true);
  });

  it("rejects settling a round that isn't in the unsettled list", () => {
    const ledger = buildCustomerLedger(1, [g(1, "2026-07-23T14:00:00Z", "2026-07-23T14:25:00Z", 100)]);
    const result = validateSettlement(ledger, { selectedGameIds: [99], amount: 100, method: "cash" });
    expect(result.valid).toBe(false);
  });

  it("rejects an empty selection", () => {
    const ledger = buildCustomerLedger(1, [g(1, "2026-07-23T14:00:00Z", "2026-07-23T14:25:00Z", 100)]);
    const result = validateSettlement(ledger, { selectedGameIds: [], amount: 0, method: "cash" });
    expect(result.valid).toBe(false);
  });
});
