import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { purgeNishani } from "../jobs/purgeNishani";

/**
 * Behavioral requirement #9 / decision #17: hard-delete a nishani once
 * every game linked to them (as loser) is fully paid and they were never
 * merged into a real customer — but never purge one with an outstanding
 * pending/loan/collateral round, and never leave a dangling FK on
 * historical (already-paid) games (see schema.prisma's onDelete: SetNull
 * note, mirrored in testDb.ts's deleteMany).
 */
describe("purgeNishani", () => {
  async function seedCommon(db: ReturnType<typeof createTestDb>) {
    const staff = await db.user.create({ data: { fullName: "Staff", username: "staff", role: "receptionist", pinHash: "x" } });
    const table = await db.table.create({ data: { tableNumber: 1, tableType: "standard", label: "Table 1" } });
    const gameType = await db.gameType.create({ data: { code: "6_ball", name: "6 Ball", defaultDurationMinutes: 25 } });
    const shift = await db.shift.create({ data: { userId: staff.id } });
    return { staff, table, gameType, shift };
  }

  it("purges a nishani whose only linked game is fully paid, nulling the FK but keeping the game", async () => {
    const db = createTestDb();
    const { staff, table, gameType, shift } = await seedCommon(db);

    const nishani = await db.customer.create({ data: { displayName: "Nishani: red shirt guy", isTemporary: true, nishaniDescription: "red shirt guy" } });
    const game = await db.game.create({
      data: {
        localUuid: "n1", tableId: table.id, gameTypeId: gameType.id,
        startTime: new Date(), endTime: new Date(),
        priceOriginal: 100, priceFinal: 100, loserCustomerId: nishani.id,
        paymentStatus: "paid", createdByUserId: staff.id, shiftId: shift.id,
      },
    });

    const result = await purgeNishani(db as any);

    expect(result.purgedIds).toContain(nishani.id);
    expect(await db.customer.findUnique({ where: { id: nishani.id } })).toBeNull();

    // The historical (already-paid) game itself is preserved — revenue
    // history is not lost — just its reference to the deleted identity.
    const survivingGame = await db.game.findUnique({ where: { id: game.id } });
    expect(survivingGame).not.toBeNull();
    expect(survivingGame!.priceFinal).toBe(100);
    expect(survivingGame!.loserCustomerId).toBeNull();
  });

  it("never purges a nishani with an outstanding pending/loan/collateral round", async () => {
    const db = createTestDb();
    const { staff, table, gameType, shift } = await seedCommon(db);

    const nishani = await db.customer.create({ data: { displayName: "Nishani: guy owes money", isTemporary: true, nishaniDescription: "guy owes money" } });
    await db.game.create({
      data: {
        localUuid: "n2", tableId: table.id, gameTypeId: gameType.id,
        startTime: new Date(), endTime: new Date(),
        priceOriginal: 100, priceFinal: 100, loserCustomerId: nishani.id,
        paymentStatus: "loan", createdByUserId: staff.id, shiftId: shift.id,
      },
    });

    const result = await purgeNishani(db as any);
    expect(result.purgedIds).not.toContain(nishani.id);
    expect(await db.customer.findUnique({ where: { id: nishani.id } })).not.toBeNull();
  });

  it("never purges a nishani that was merged into a real customer", async () => {
    const db = createTestDb();
    const real = await db.customer.create({ data: { displayName: "Real Person" } });
    const nishani = await db.customer.create({
      data: { displayName: "Nishani: merged one", isTemporary: true, nishaniDescription: "merged one", mergedIntoCustomerId: real.id },
    });

    const result = await purgeNishani(db as any);
    expect(result.purgedIds).not.toContain(nishani.id);
  });

  it("is a no-op when there are no nishani customers", async () => {
    const db = createTestDb();
    const result = await purgeNishani(db as any);
    expect(result.purgedCount).toBe(0);
  });
});
