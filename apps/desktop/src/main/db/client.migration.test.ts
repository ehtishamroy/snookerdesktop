import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Regression test for the "games.loser_customer_id becomes nullable"
 * migration in client.ts — anyone who already has the desktop app installed
 * has a local SQLite file with the OLD `NOT NULL` constraint baked in, and
 * `CREATE TABLE IF NOT EXISTS` can't fix that retroactively. This proves the
 * rebuild-in-place migration runs without throwing and doesn't drop the
 * pre-existing row.
 */
describe("client.ts games.loser_customer_id migration", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `snooker-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`);
    process.env.SNOOKER_DB_PATH = dbPath;
  });

  it("rebuilds an old NOT NULL games table in place, preserving existing rows", async () => {
    // Simulate an install from before this change: only the old-shape games
    // table exists on disk, with the NOT NULL constraint this migration
    // needs to lift.
    const raw = new Database(dbPath);
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      CREATE TABLE games (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        local_uuid               TEXT NOT NULL UNIQUE,
        server_id                INTEGER,
        table_id                 INTEGER NOT NULL,
        game_type_id             INTEGER NOT NULL,
        start_time               TEXT NOT NULL,
        end_time                 TEXT,
        duration_actual_minutes  REAL,
        duration_billed_minutes  INTEGER,
        price_original           INTEGER NOT NULL,
        discount_amount          INTEGER NOT NULL DEFAULT 0,
        discount_reason          TEXT,
        discount_by_id           INTEGER,
        price_final              INTEGER NOT NULL,
        loser_customer_id        INTEGER NOT NULL,
        winner_customer_id       INTEGER,
        payment_status           TEXT NOT NULL,
        created_by_user_id       INTEGER NOT NULL,
        shift_id                 INTEGER NOT NULL,
        reversed                 INTEGER NOT NULL DEFAULT 0,
        reversed_by_id           INTEGER,
        reversed_reason          TEXT,
        reversed_at              TEXT,
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );
      CREATE INDEX idx_games_loser_status ON games (loser_customer_id, payment_status, reversed);
      CREATE INDEX idx_games_table_start ON games (table_id, start_time);
      CREATE INDEX idx_games_open ON games (table_id, end_time, reversed);
    `);
    const now = new Date().toISOString();
    raw
      .prepare(
        `INSERT INTO games (
           local_uuid, table_id, game_type_id, start_time, price_original, discount_amount, price_final,
           loser_customer_id, payment_status, created_by_user_id, shift_id, created_at, updated_at
         ) VALUES ('preexisting-game', 1, 1, ?, 100, 0, 100, 42, 'paid', 1, 1, ?, ?)`
      )
      .run(now, now, now);
    raw.close();

    vi.resetModules();
    const client = await import("./client");
    const db = client.getDb();

    const columns = db.prepare(`PRAGMA table_info(games)`).all() as { name: string; notnull: number }[];
    const loserColumn = columns.find((c) => c.name === "loser_customer_id");
    expect(loserColumn?.notnull).toBe(0);

    const preserved = db.prepare(`SELECT * FROM games WHERE local_uuid = ?`).get("preexisting-game") as any;
    expect(preserved).toBeTruthy();
    expect(preserved.loser_customer_id).toBe(42);
    expect(preserved.price_final).toBe(100);

    // The rebuild shouldn't have disturbed normal first-run seeding either.
    const tableCount = (db.prepare("SELECT COUNT(*) AS c FROM tables").get() as { c: number }).c;
    expect(tableCount).toBe(6);

    client.closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  });
});
