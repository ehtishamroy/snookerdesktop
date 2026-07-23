import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { createGame, updateGame } from "../services/gameService";

/**
 * End-to-end (through the games "API" service layer, not just the pure
 * computeBilling function already unit-tested in packages/shared) test of
 * behavioral requirement #5/#6 and decision #1: per-minute overtime
 * billing, and the table_status_log vacancy window opening/closing that
 * must happen alongside it.
 */
describe("overtime billing end-to-end", () => {
  async function seedBaseline(db: ReturnType<typeof createTestDb>) {
    const owner = await db.user.create({ data: { fullName: "Owner", username: "owner", role: "owner", pinHash: "x" } });
    const receptionist = await db.user.create({ data: { fullName: "Receptionist", username: "recep", role: "receptionist", pinHash: "x" } });
    const table = await db.table.create({ data: { tableNumber: 1, tableType: "standard", label: "Table 1" } });
    await db.tableStatusLog.create({ data: { tableId: table.id, status: "vacant", statusFrom: new Date("2026-07-23T09:00:00Z"), statusTo: null } });
    const gameType = await db.gameType.create({ data: { code: "6_ball", name: "6 Ball Single", defaultDurationMinutes: 25 } });
    await db.pricingRule.create({
      data: { tableType: "standard", gameTypeId: gameType.id, price: 100, durationMinutes: 25, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, createdById: owner.id },
    });
    const customer = await db.customer.create({ data: { displayName: "Ali" } });
    const shift = await db.shift.create({ data: { userId: receptionist.id } });
    return { owner, receptionist, table, gameType, customer, shift };
  }

  it("bills the full block when the game ends within the block duration", async () => {
    const db = createTestDb();
    const { receptionist, table, gameType, customer } = await seedBaseline(db);
    const startTime = "2026-07-23T10:00:00.000Z";

    const created = await createGame(
      db as any,
      { localUuid: "g1", tableId: table.id, gameTypeId: gameType.id, startTime, loserCustomerId: customer.id },
      receptionist.id
    );
    expect(created.priceOriginal).toBe(100);

    // Finished after only 10 minutes — full block price still applies (no downward proration).
    const ended = await updateGame(
      db as any,
      created.id,
      { endTime: "2026-07-23T10:10:00.000Z" },
      { userId: receptionist.id, role: "receptionist" }
    );
    expect(ended.durationBilledMinutes).toBe(25);
    expect(ended.priceFinal).toBe(100);
  });

  it("bills strictly per minute for overtime past the block, rounded up", async () => {
    const db = createTestDb();
    const { receptionist, table, gameType, customer } = await seedBaseline(db);
    const startTime = "2026-07-23T10:00:00.000Z";

    const created = await createGame(
      db as any,
      { localUuid: "g2", tableId: table.id, gameTypeId: gameType.id, startTime, loserCustomerId: customer.id },
      receptionist.id
    );

    // Closes the initial vacant window at game start.
    const vacantAfterStart = await db.tableStatusLog.findFirst({ where: { tableId: table.id, statusTo: null } });
    expect(vacantAfterStart).toBeNull();

    // Played 25 min block + 7.4 min overtime -> rounds up to 8 overtime minutes.
    // Rate = 100/25 = 4/min -> overtime = 8 * 4 = 32 -> total 132.
    const ended = await updateGame(
      db as any,
      created.id,
      { endTime: "2026-07-23T10:32:24.000Z" },
      { userId: receptionist.id, role: "receptionist" }
    );

    expect(ended.durationBilledMinutes).toBe(33); // 25 + 8
    expect(ended.priceOriginal).toBe(132);
    expect(ended.priceFinal).toBe(132);

    // Ending the game must open a fresh vacant window (requirement #6).
    const vacantAfterEnd = await db.tableStatusLog.findFirst({ where: { tableId: table.id, statusTo: null } });
    expect(vacantAfterEnd).not.toBeNull();
    expect(new Date(vacantAfterEnd!.statusFrom).toISOString()).toBe("2026-07-23T10:32:24.000Z");
  });

  it("writes an audit_log row for both create and end (update)", async () => {
    const db = createTestDb();
    const { receptionist, table, gameType, customer } = await seedBaseline(db);

    const created = await createGame(
      db as any,
      { localUuid: "g3", tableId: table.id, gameTypeId: gameType.id, startTime: "2026-07-23T10:00:00.000Z", loserCustomerId: customer.id },
      receptionist.id
    );
    await updateGame(db as any, created.id, { endTime: "2026-07-23T10:05:00.000Z" }, { userId: receptionist.id, role: "receptionist" });

    const auditRows = await db.auditLog.findMany({ where: { entityType: "game", entityId: created.id } });
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toEqual(["create", "update"]);
  });
});
