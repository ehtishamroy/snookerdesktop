import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Any staff can correct an expense after the fact, but it must always be visibly flagged (so the owner notices). */
describe("expensesRepo.updateExpense", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `snooker-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`);
    process.env.SNOOKER_DB_PATH = dbPath;
  });

  async function freshModules() {
    vi.resetModules();
    const client = await import("../client");
    const expensesRepo = await import("./expensesRepo");
    const shiftsRepo = await import("./shiftsRepo");
    return { client, expensesRepo, shiftsRepo };
  }

  it("corrects a mistaken expense and flags it as edited without touching other fields", async () => {
    const { client, expensesRepo, shiftsRepo } = await freshModules();
    const db = client.getDb();
    const ownerId = (db.prepare("SELECT id FROM users WHERE username = 'owner'").get() as { id: number }).id;
    const shift = shiftsRepo.openShiftForUser(ownerId);

    const created = expensesRepo.createExpense({
      category: "Canteen restock",
      amount: 500,
      method: "cash",
      recordedByUserId: ownerId,
      shiftId: shift.id,
    });
    expect(created.edited).toBe(false);
    expect(created.editedAt).toBeNull();

    const updated = expensesRepo.updateExpense({
      expenseId: created.id,
      patch: { amount: 50 }, // fixed a typo — should have been Rs. 50, not Rs. 500
      performedByUserId: ownerId,
    });

    expect(updated.amount).toBe(50);
    expect(updated.category).toBe("Canteen restock"); // untouched
    expect(updated.edited).toBe(true);
    expect(updated.editedAt).not.toBeNull();
    expect(updated.editedById).toBe(ownerId);

    client.closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  });
});
