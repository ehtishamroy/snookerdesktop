import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { mergeCustomers, searchCustomers } from "../services/customerService";

describe("customer merge", () => {
  it("re-points games, payments, and collateral to the target customer and preserves history", async () => {
    const db = createTestDb();
    const staff = await db.user.create({ data: { fullName: "Staff", username: "staff", role: "receptionist", pinHash: "x" } });
    const table = await db.table.create({ data: { tableNumber: 1, tableType: "standard", label: "Table 1" } });
    const gameType = await db.gameType.create({ data: { code: "6_ball", name: "6 Ball", defaultDurationMinutes: 25 } });
    const shift = await db.shift.create({ data: { userId: staff.id } });

    const dup = await db.customer.create({ data: { displayName: "Aslam bhai" } });
    const canonical = await db.customer.create({ data: { displayName: "Muhammad Aslam" } });

    const game = await db.game.create({
      data: {
        localUuid: "m1", tableId: table.id, gameTypeId: gameType.id,
        startTime: new Date(), endTime: new Date(),
        priceOriginal: 100, priceFinal: 100, loserCustomerId: dup.id,
        paymentStatus: "paid", createdByUserId: staff.id, shiftId: shift.id,
      },
    });
    const payment = await db.payment.create({ data: { customerId: dup.id, amount: 100, method: "cash", collectedByUserId: staff.id, shiftId: shift.id } });
    const collateral = await db.collateralItem.create({ data: { gameId: game.id, customerId: dup.id, itemDescription: "Motorbike key", heldByUserId: staff.id } });

    const merged = await mergeCustomers(db as any, dup.id, canonical.id, staff.id);
    expect(merged.mergedIntoCustomerId).toBe(canonical.id);

    const gameAfter = await db.game.findUnique({ where: { id: game.id } });
    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id } });
    const collateralAfter = await db.collateralItem.findUnique({ where: { id: collateral.id } });

    expect(gameAfter!.loserCustomerId).toBe(canonical.id);
    expect(paymentAfter!.customerId).toBe(canonical.id);
    expect(collateralAfter!.customerId).toBe(canonical.id);

    // History is preserved, not duplicated — the game row still exists with its original price.
    expect(gameAfter!.priceFinal).toBe(100);

    const auditRows = await db.auditLog.findMany({ where: { entityType: "customer", entityId: dup.id, action: "merge" } });
    expect(auditRows.length).toBe(1);
  });

  it("refuses to merge a customer that was already merged elsewhere", async () => {
    const db = createTestDb();
    const staff = await db.user.create({ data: { fullName: "Staff", username: "staff", role: "receptionist", pinHash: "x" } });
    const a = await db.customer.create({ data: { displayName: "A" } });
    const b = await db.customer.create({ data: { displayName: "B" } });
    const c = await db.customer.create({ data: { displayName: "C" } });

    await mergeCustomers(db as any, a.id, b.id, staff.id);
    await expect(mergeCustomers(db as any, a.id, c.id, staff.id)).rejects.toThrow(/already merged/);
  });

  it("search excludes unmerged nishani customers from autosuggest (behavioral requirement #8)", async () => {
    const db = createTestDb();
    await db.customer.create({ data: { displayName: "Real Zeeshan" } });
    await db.customer.create({ data: { displayName: "Nishani: guy in blue", isTemporary: true, nishaniDescription: "guy in blue" } });

    const results = await searchCustomers(db as any, undefined);
    expect(results.some((c: any) => c.isTemporary)).toBe(false);
    expect(results.some((c: any) => c.displayName === "Real Zeeshan")).toBe(true);
  });
});
