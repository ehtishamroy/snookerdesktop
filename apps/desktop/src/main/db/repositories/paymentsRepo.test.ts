import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Integration test for settling a customer's ledger with a discount applied (spec §5.3 + decision #3). */
describe("paymentsRepo.settle (customer ledger discount)", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `snooker-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`);
    process.env.SNOOKER_DB_PATH = dbPath;
  });

  async function freshModules() {
    vi.resetModules();
    const client = await import("../client");
    const gamesRepo = await import("./gamesRepo");
    const customersRepo = await import("./customersRepo");
    const shiftsRepo = await import("./shiftsRepo");
    const paymentsRepo = await import("./paymentsRepo");
    return { client, gamesRepo, customersRepo, shiftsRepo, paymentsRepo };
  }

  it("spreads a discount proportionally across the selected rounds and collects the reduced total", async () => {
    const { client, gamesRepo, customersRepo, shiftsRepo, paymentsRepo } = await freshModules();
    const db = client.getDb();
    const ownerId = (db.prepare("SELECT id FROM users WHERE username = 'owner'").get() as { id: number }).id;
    const shift = shiftsRepo.openShiftForUser(ownerId);
    const customer = customersRepo.createCustomer({ displayName: "Owes Money" });

    // Round 1: Rs. 100 (6 Ball, standard table).
    const game1 = gamesRepo.startGame({
      tableId: 1,
      gameTypeId: 1,
      startTime: new Date().toISOString(),
      loserCustomerId: customer.id,
      createdByUserId: ownerId,
      shiftId: shift.id,
    });
    gamesRepo.endGame({
      gameId: game1.id,
      endTime: new Date().toISOString(),
      paymentStatus: "pending",
      performedByUserId: ownerId,
      shiftId: shift.id,
    });

    // Round 2: Rs. 300 (Full Frame Double, standard table).
    const game2 = gamesRepo.startGame({
      tableId: 2,
      gameTypeId: 4,
      startTime: new Date().toISOString(),
      loserCustomerId: customer.id,
      createdByUserId: ownerId,
      shiftId: shift.id,
    });
    gamesRepo.endGame({
      gameId: game2.id,
      endTime: new Date().toISOString(),
      paymentStatus: "pending",
      performedByUserId: ownerId,
      shiftId: shift.id,
    });

    // Rs. 100 discount across a Rs. 400 total (100 + 300) -> game1 loses
    // 25% of the discount's share proportionally (Rs. 25), game2 (the last
    // selected round) absorbs the rest (Rs. 75) so the total is exact.
    const payment = paymentsRepo.settle({
      customerId: customer.id,
      selectedGameIds: [game1.id, game2.id],
      method: "cash",
      discountAmount: 100,
      discountReason: "Regular customer",
      collectedByUserId: ownerId,
      shiftId: shift.id,
    });

    expect(payment.amount).toBe(300); // 400 - 100 discount

    const updatedGame1 = gamesRepo.getGameById(game1.id);
    const updatedGame2 = gamesRepo.getGameById(game2.id);
    expect(updatedGame1.priceFinal + updatedGame2.priceFinal).toBe(300);
    expect(updatedGame1.discountAmount).toBe(25);
    expect(updatedGame2.discountAmount).toBe(75);
    expect(updatedGame1.paymentStatus).toBe("paid");
    expect(updatedGame2.paymentStatus).toBe("paid");

    client.closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  });
});
