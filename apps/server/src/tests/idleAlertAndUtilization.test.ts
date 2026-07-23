import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { getIdleAlerts, getUtilizationReport } from "../services/reportService";

describe("idle alert detection (behavioral requirement #6, jobs/idleAlertScan.ts)", () => {
  it("flags a game running past double its expected block duration, and not one still within it", async () => {
    const db = createTestDb();
    const staff = await db.user.create({ data: { fullName: "Staff", username: "staff", role: "receptionist", pinHash: "x" } });
    const table = await db.table.create({ data: { tableNumber: 1, tableType: "standard", label: "Table 1" } });
    const gameType = await db.gameType.create({ data: { code: "6_ball", name: "6 Ball", defaultDurationMinutes: 25 } });
    const customer = await db.customer.create({ data: { displayName: "Idle Guy" } });
    const shift = await db.shift.create({ data: { userId: staff.id } });

    const now = Date.now();
    // Started 60 minutes ago on a 25-min game — 60 > 2 * 25, should alert.
    await db.game.create({
      data: {
        localUuid: "idle1", tableId: table.id, gameTypeId: gameType.id,
        startTime: new Date(now - 60 * 60000), loserCustomerId: customer.id,
        priceOriginal: 100, priceFinal: 100, paymentStatus: "pending", createdByUserId: staff.id, shiftId: shift.id,
      },
    });
    // Started 10 minutes ago — well within the block, no alert.
    await db.game.create({
      data: {
        localUuid: "idle2", tableId: table.id, gameTypeId: gameType.id,
        startTime: new Date(now - 10 * 60000), loserCustomerId: customer.id,
        priceOriginal: 100, priceFinal: 100, paymentStatus: "pending", createdByUserId: staff.id, shiftId: shift.id,
      },
    });

    const alerts = await getIdleAlerts(db as any);
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.gameId).toBeDefined();
    expect(alerts[0]!.tableNumber).toBe(1);
  });
});

describe("table utilization report (§2.7)", () => {
  it("reconstructs occupied windows as the complement of vacant windows within the range", async () => {
    const db = createTestDb();
    const table = await db.table.create({ data: { tableNumber: 2, tableType: "standard", label: "Table 2" } });

    const from = new Date("2026-07-23T09:00:00Z");
    const to = new Date("2026-07-23T11:00:00Z");

    // Vacant 09:00-09:30, occupied 09:30-10:15 (implicit gap), vacant 10:15-11:00.
    await db.tableStatusLog.create({
      data: { tableId: table.id, status: "vacant", statusFrom: new Date("2026-07-23T09:00:00Z"), statusTo: new Date("2026-07-23T09:30:00Z") },
    });
    await db.tableStatusLog.create({
      data: { tableId: table.id, status: "vacant", statusFrom: new Date("2026-07-23T10:15:00Z"), statusTo: null },
    });

    const [report] = await getUtilizationReport(db as any, { tableId: table.id, from, to });
    expect(report!.vacantMinutes).toBe(30 + 45); // 09:00-09:30 + 10:15-11:00
    expect(report!.occupiedMinutes).toBe(45); // 09:30-10:15
    expect(report!.utilizationPercent).toBeCloseTo((45 / 120) * 100, 5);
  });
});
