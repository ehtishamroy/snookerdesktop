import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Table Details screen's "when was this table free" view — spec §2.7's vacancy log. */
describe("tableStatusLogRepo.getVacancyHistory", () => {
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
    const tableStatusLogRepo = await import("./tableStatusLogRepo");
    return { client, gamesRepo, customersRepo, shiftsRepo, tableStatusLogRepo };
  }

  it("reports the vacant window before a game starts and the new one opened once it ends", async () => {
    const { client, gamesRepo, customersRepo, shiftsRepo, tableStatusLogRepo } = await freshModules();
    const db = client.getDb();
    const ownerId = (db.prepare("SELECT id FROM users WHERE username = 'owner'").get() as { id: number }).id;
    const shift = shiftsRepo.openShiftForUser(ownerId);
    const customer = customersRepo.createCustomer({ displayName: "Vacancy Test" });

    // Pricing rules are only effective from the moment the DB was seeded
    // ("now"), and getVacancyHistory queries up to the real wall-clock "now"
    // at call time — so both the start and end time need to be real,
    // roughly-current timestamps rather than a synthetic offset in either
    // direction.
    const startTime = new Date();
    const game = gamesRepo.startGame({
      tableId: 5,
      gameTypeId: 1,
      startTime: startTime.toISOString(),
      loserCustomerId: customer.id,
      createdByUserId: ownerId,
      shiftId: shift.id,
    });

    const endTime = new Date();
    gamesRepo.endGame({
      gameId: game.id,
      endTime: endTime.toISOString(),
      paymentStatus: "pending",
      performedByUserId: ownerId,
      shiftId: shift.id,
    });

    const history = tableStatusLogRepo.getVacancyHistory(5);

    // Two vacant windows: the seeded one before the game started, and the
    // fresh one opened the moment the game ended (still open now).
    expect(history.windows.length).toBeGreaterThanOrEqual(2);
    const closedWindow = history.windows.find((w) => new Date(w.to).getTime() === startTime.getTime());
    expect(closedWindow).toBeTruthy();

    const openWindow = history.windows.find((w) => new Date(w.from).getTime() === endTime.getTime());
    expect(openWindow).toBeTruthy();
    expect(openWindow!.durationMinutes).toBeGreaterThanOrEqual(0);

    expect(history.totalOccupiedMinutes).toBeGreaterThanOrEqual(0);
    expect(history.utilizationPercent).toBeGreaterThanOrEqual(0);

    client.closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  });
});
