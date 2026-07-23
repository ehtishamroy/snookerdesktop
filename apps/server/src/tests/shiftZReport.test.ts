import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { closeShift, openShift } from "../services/shiftService";

/**
 * Decision #5 / behavioral requirement: "Close Shift" computes a Z-report
 * (declared cash vs. system total) via the shared buildZReport, and locks
 * the shift.
 */
describe("shift close / Z-report", () => {
  it("computes cash variance correctly against payments and expenses", async () => {
    const db = createTestDb();
    const staff = await db.user.create({ data: { fullName: "Staff", username: "staff", role: "receptionist", pinHash: "x" } });

    const shift = await openShift(db as any, staff.id);
    expect(shift.closedAt).toBeNull();

    const customer = await db.customer.create({ data: { displayName: "Cust" } });
    await db.payment.create({ data: { customerId: customer.id, amount: 500, method: "cash", collectedByUserId: staff.id, shiftId: shift.id } });
    await db.payment.create({ data: { customerId: customer.id, amount: 300, method: "easypaisa", collectedByUserId: staff.id, shiftId: shift.id } });
    await db.expense.create({ data: { category: "Canteen restock", amount: 120, method: "cash", recordedByUserId: staff.id, shiftId: shift.id } });

    const table = await db.table.create({ data: { tableNumber: 1, tableType: "standard", label: "Table 1" } });
    const gameType = await db.gameType.create({ data: { code: "6_ball", name: "6 Ball", defaultDurationMinutes: 25 } });
    await db.game.create({
      data: {
        localUuid: "z1", tableId: table.id, gameTypeId: gameType.id,
        startTime: new Date(), endTime: new Date(),
        priceOriginal: 100, discountAmount: 10, priceFinal: 90,
        loserCustomerId: customer.id, paymentStatus: "tricked",
        createdByUserId: staff.id, shiftId: shift.id,
      },
    });

    // system cash = 500 (cash payments) - 120 (cash expense) = 380
    // declared 400 -> variance = +20
    const { shift: closed, zReport } = await closeShift(db as any, shift.id, 400, { userId: staff.id, role: "receptionist" });

    expect(zReport.totalsByMethod.cash).toBe(500);
    expect(zReport.totalsByMethod.easypaisa).toBe(300);
    expect(zReport.systemCashTotal).toBe(380);
    expect(zReport.cashVariance).toBe(20);
    expect(zReport.totalDiscountsGiven).toBe(10);
    expect(zReport.totalTrickedCount).toBe(1);
    expect(closed.isLocked).toBe(true);
    expect(closed.closedAt).not.toBeNull();
    expect(closed.systemCashTotal).toBe(380);
    expect(closed.cashVariance).toBe(20);
  });

  it("excludes reversed games from the Z-report totals", async () => {
    const db = createTestDb();
    const staff = await db.user.create({ data: { fullName: "Staff", username: "staff", role: "receptionist", pinHash: "x" } });
    const shift = await openShift(db as any, staff.id);
    const customer = await db.customer.create({ data: { displayName: "Cust" } });
    const table = await db.table.create({ data: { tableNumber: 1, tableType: "standard", label: "Table 1" } });
    const gameType = await db.gameType.create({ data: { code: "6_ball", name: "6 Ball", defaultDurationMinutes: 25 } });

    await db.game.create({
      data: {
        localUuid: "z2", tableId: table.id, gameTypeId: gameType.id,
        startTime: new Date(), endTime: new Date(),
        priceOriginal: 100, discountAmount: 0, priceFinal: 100,
        loserCustomerId: customer.id, paymentStatus: "pending",
        createdByUserId: staff.id, shiftId: shift.id, reversed: true,
      },
    });

    const { zReport } = await closeShift(db as any, shift.id, 0, { userId: staff.id, role: "receptionist" });
    expect(zReport.totalPendingCreated).toBe(0);
  });

  it("refuses to close an already-closed shift", async () => {
    const db = createTestDb();
    const staff = await db.user.create({ data: { fullName: "Staff", username: "staff", role: "receptionist", pinHash: "x" } });
    const shift = await openShift(db as any, staff.id);
    await closeShift(db as any, shift.id, 0, { userId: staff.id, role: "receptionist" });

    await expect(closeShift(db as any, shift.id, 0, { userId: staff.id, role: "receptionist" })).rejects.toThrow(/already closed/);
  });
});
