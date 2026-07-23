import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Integration test for the local-first counter flow through the real
 * better-sqlite3 schema (not the pure @snooker/shared math, which already
 * has its own unit tests) — this is what actually proves requirement #1
 * ("every write goes to local SQLite, transactionally, before the UI
 * confirms") and requirement #2 ("every write also enqueues a sync_queue
 * row") end-to-end.
 */
describe("gamesRepo (local-first offline counter flow)", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `snooker-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`);
    process.env.SNOOKER_DB_PATH = dbPath;
  });

  async function freshModules() {
    // Each test needs its own getDb() singleton (module-level `let db`), so
    // reset the module registry rather than reusing one connection across
    // tests with different SNOOKER_DB_PATH values.
    vi.resetModules();
    const client = await import("../client");
    const gamesRepo = await import("./gamesRepo");
    const customersRepo = await import("./customersRepo");
    const shiftsRepo = await import("./shiftsRepo");
    const syncQueueRepo = await import("./syncQueueRepo");
    return { client, gamesRepo, customersRepo, shiftsRepo, syncQueueRepo };
  }

  it("starting and ending a game bills per-minute overtime and enqueues sync_queue rows", async () => {
    const { client, gamesRepo, customersRepo, shiftsRepo, syncQueueRepo } = await freshModules();
    const db = client.getDb();

    const ownerId = (db.prepare("SELECT id FROM users WHERE username = 'owner'").get() as { id: number }).id;
    const shift = shiftsRepo.openShiftForUser(ownerId);
    const customer = customersRepo.createNishaniCustomer({ nishaniDescription: "Red shirt, table 3 regular" });

    const startTime = new Date("2026-07-23T10:00:00.000Z");
    const game = gamesRepo.startGame({
      tableId: 1,
      gameTypeId: 1, // 6 Ball, standard table: Rs. 100 / 25 min
      startTime: startTime.toISOString(),
      loserCustomerId: customer.id,
      createdByUserId: ownerId,
      shiftId: shift.id,
    });

    expect(game.priceOriginal).toBe(100);
    expect(game.paymentStatus).toBe("pending");

    // Played 32 minutes: 25-min block + 7 min overtime @ 4 PKR/min = Rs. 28 => Rs. 128 total.
    const endTime = new Date(startTime.getTime() + 32 * 60_000);
    const ended = gamesRepo.endGame({
      gameId: game.id,
      endTime: endTime.toISOString(),
      paymentStatus: "paid",
      paymentMethod: "cash",
      performedByUserId: ownerId,
      shiftId: shift.id,
    });

    expect(ended.durationBilledMinutes).toBe(32);
    expect(ended.priceOriginal).toBe(128);
    expect(ended.priceFinal).toBe(128);

    // Every write (start + end) must have queued a sync_queue row so the
    // background sync engine can push it once online. The update op gets its
    // own queue-row uuid (not the game's own local_uuid), so filter by entity
    // type + operation instead.
    const pending = syncQueueRepo.getPendingBatch(db, 10);
    const gameInserts = pending.filter((row) => row.entity_type === "games" && row.operation === "insert");
    const gameUpdates = pending.filter((row) => row.entity_type === "games" && row.operation === "update");
    expect(gameInserts.length).toBeGreaterThanOrEqual(1);
    expect(gameUpdates.length).toBeGreaterThanOrEqual(1);

    client.closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  });

  it("rejects marking a round Paid without a payment method (unrestricted discount, but method is still required)", async () => {
    const { client, gamesRepo, customersRepo, shiftsRepo } = await freshModules();
    const db = client.getDb();
    const ownerId = (db.prepare("SELECT id FROM users WHERE username = 'owner'").get() as { id: number }).id;
    const shift = shiftsRepo.openShiftForUser(ownerId);
    const customer = customersRepo.createCustomer({ displayName: "Ali" });

    const game = gamesRepo.startGame({
      tableId: 2,
      gameTypeId: 3, // Full Frame
      startTime: new Date().toISOString(),
      loserCustomerId: customer.id,
      createdByUserId: ownerId,
      shiftId: shift.id,
    });

    expect(() =>
      gamesRepo.endGame({
        gameId: game.id,
        endTime: new Date().toISOString(),
        paymentStatus: "paid",
        performedByUserId: ownerId,
        shiftId: shift.id,
      })
    ).toThrow(/payment method/i);

    client.closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  });

  it("applies an unrestricted discount regardless of who ends the game (decision #3 — no approval gate)", async () => {
    const { client, gamesRepo, customersRepo, shiftsRepo } = await freshModules();
    const db = client.getDb();
    const ownerId = (db.prepare("SELECT id FROM users WHERE username = 'owner'").get() as { id: number }).id;
    const shift = shiftsRepo.openShiftForUser(ownerId);
    const customer = customersRepo.createCustomer({ displayName: "Bilal" });

    const game = gamesRepo.startGame({
      tableId: 3,
      gameTypeId: 5, // Century: Rs. 600 / 60 min
      startTime: new Date("2026-07-23T09:00:00.000Z").toISOString(),
      loserCustomerId: customer.id,
      createdByUserId: ownerId,
      shiftId: shift.id,
    });

    const ended = gamesRepo.endGame({
      gameId: game.id,
      endTime: new Date("2026-07-23T09:50:00.000Z").toISOString(),
      paymentStatus: "paid",
      paymentMethod: "easypaisa",
      discountAmount: 550, // a huge discount on a Rs. 600 game, no threshold blocks it
      discountReason: "Regular customer, owner not present but still allowed",
      discountByUserId: ownerId,
      performedByUserId: ownerId,
      shiftId: shift.id,
    });

    expect(ended.discountAmount).toBe(550);
    expect(ended.priceFinal).toBe(50);

    client.closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  });
});
