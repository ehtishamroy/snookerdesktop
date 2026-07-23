import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { createGame, updateGame } from "../services/gameService";

/**
 * Decision #3: discounts have NO approval gate for any role. A plain
 * receptionist must be able to apply a huge (even 100%) discount without
 * any owner/manager sign-off, gate, or rejection — only full attribution
 * for audit purposes.
 */
describe("discounts are unrestricted regardless of role", () => {
  it("lets a receptionist apply a full, unapproved discount", async () => {
    const db = createTestDb();
    const owner = await db.user.create({ data: { fullName: "Owner", username: "owner", role: "owner", pinHash: "x" } });
    const receptionist = await db.user.create({ data: { fullName: "Receptionist", username: "recep", role: "receptionist", pinHash: "x" } });
    const table = await db.table.create({ data: { tableNumber: 1, tableType: "standard", label: "Table 1" } });
    const gameType = await db.gameType.create({ data: { code: "century", name: "Century", defaultDurationMinutes: 60 } });
    await db.pricingRule.create({
      data: { tableType: "standard", gameTypeId: gameType.id, price: 600, durationMinutes: 60, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, createdById: owner.id },
    });
    const customer = await db.customer.create({ data: { displayName: "Bilal" } });
    await db.shift.create({ data: { userId: receptionist.id } });

    const created = await createGame(
      db as any,
      { localUuid: "d1", tableId: table.id, gameTypeId: gameType.id, startTime: "2026-07-23T10:00:00.000Z", loserCustomerId: customer.id },
      receptionist.id
    );

    // A receptionist ends the game and gives away the entire 600 for free —
    // no owner/manager approval step exists anywhere in this flow.
    const updated = await updateGame(
      db as any,
      created.id,
      { endTime: "2026-07-23T11:00:00.000Z", discountAmount: 600, discountReason: "Regular customer, manager's call" },
      { userId: receptionist.id, role: "receptionist" }
    );

    expect(updated.discountAmount).toBe(600);
    expect(updated.priceFinal).toBe(0);
    // Still fully attributed for audit/reporting, per decision #3.
    expect(updated.discountById).toBe(receptionist.id);
  });

  it("clamps a discount that exceeds the price rather than going negative, but still applies it unapproved", async () => {
    const db = createTestDb();
    const owner = await db.user.create({ data: { fullName: "Owner", username: "owner", role: "owner", pinHash: "x" } });
    const receptionist = await db.user.create({ data: { fullName: "Receptionist", username: "recep", role: "receptionist", pinHash: "x" } });
    const table = await db.table.create({ data: { tableNumber: 1, tableType: "standard", label: "Table 1" } });
    const gameType = await db.gameType.create({ data: { code: "6_ball", name: "6 Ball", defaultDurationMinutes: 25 } });
    await db.pricingRule.create({
      data: { tableType: "standard", gameTypeId: gameType.id, price: 100, durationMinutes: 25, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, createdById: owner.id },
    });
    const customer = await db.customer.create({ data: { displayName: "Sana" } });
    await db.shift.create({ data: { userId: receptionist.id } });

    const created = await createGame(
      db as any,
      { localUuid: "d2", tableId: table.id, gameTypeId: gameType.id, startTime: "2026-07-23T10:00:00.000Z", loserCustomerId: customer.id, discountAmount: 999999 },
      receptionist.id
    );

    expect(created.discountAmount).toBe(100); // clamped to priceOriginal
    expect(created.priceFinal).toBe(0);
  });
});
