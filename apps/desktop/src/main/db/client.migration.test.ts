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

  function createOldGamesAndChildren(raw: Database.Database): void {
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

      CREATE TABLE payments (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        local_uuid          TEXT NOT NULL UNIQUE,
        server_id           INTEGER,
        customer_id         INTEGER NOT NULL,
        amount              INTEGER NOT NULL,
        method              TEXT NOT NULL,
        note                TEXT,
        paid_at             TEXT NOT NULL,
        collected_by_user_id INTEGER NOT NULL,
        shift_id            INTEGER NOT NULL
      );

      CREATE TABLE payment_game_links (
        payment_id INTEGER NOT NULL REFERENCES payments (id),
        game_id    INTEGER NOT NULL REFERENCES games (id),
        PRIMARY KEY (payment_id, game_id)
      );

      CREATE TABLE collateral_items (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        local_uuid          TEXT NOT NULL UNIQUE,
        server_id           INTEGER,
        game_id             INTEGER NOT NULL REFERENCES games (id),
        customer_id         INTEGER NOT NULL,
        item_description    TEXT NOT NULL,
        held_by_user_id     INTEGER NOT NULL,
        held_at             TEXT NOT NULL,
        returned             INTEGER NOT NULL DEFAULT 0,
        returned_at          TEXT,
        returned_by_user_id  INTEGER,
        updated_at           TEXT NOT NULL
      );
      CREATE INDEX idx_collateral_customer ON collateral_items (customer_id, returned);
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
    raw
      .prepare(
        `INSERT INTO payments (local_uuid, customer_id, amount, method, paid_at, collected_by_user_id, shift_id)
         VALUES ('preexisting-payment', 42, 100, 'cash', ?, 1, 1)`
      )
      .run(now);
    raw.prepare(`INSERT INTO payment_game_links (payment_id, game_id) VALUES (1, 1)`).run();
    raw
      .prepare(
        `INSERT INTO collateral_items (local_uuid, game_id, customer_id, item_description, held_by_user_id, held_at, updated_at)
         VALUES ('preexisting-collateral', 1, 42, 'black phone', 1, ?, ?)`
      )
      .run(now, now);
  }

  it("rebuilds an old NOT NULL games table in place, preserving existing rows and keeping payment_game_links/collateral_items usable", async () => {
    // Simulate a full old install: games with the NOT NULL constraint this
    // migration needs to lift, plus its two child tables that reference
    // `games` by foreign key — exercising the exact shape that broke in
    // production ("no such table: games_pre_nullable_loser" on End Game,
    // because SQLite's rename fixup silently repointed their FK at the
    // renamed table, which then got dropped).
    const raw = new Database(dbPath);
    createOldGamesAndChildren(raw);
    raw.close();

    vi.resetModules();
    const client = await import("./client");
    const db = client.getDb();

    const columns = db.prepare(`PRAGMA table_info(games)`).all() as { name: string; notnull: number }[];
    const loserColumn = columns.find((c) => c.name === "loser_customer_id");
    expect(loserColumn?.notnull).toBe(0);

    const preservedGame = db.prepare(`SELECT * FROM games WHERE local_uuid = ?`).get("preexisting-game") as any;
    expect(preservedGame).toBeTruthy();
    expect(preservedGame.loser_customer_id).toBe(42);
    expect(preservedGame.price_final).toBe(100);

    const preservedLink = db
      .prepare(`SELECT * FROM payment_game_links WHERE game_id = ?`)
      .get(preservedGame.id) as any;
    expect(preservedLink).toBeTruthy();

    const preservedCollateral = db
      .prepare(`SELECT * FROM collateral_items WHERE local_uuid = ?`)
      .get("preexisting-collateral") as any;
    expect(preservedCollateral).toBeTruthy();
    expect(preservedCollateral.game_id).toBe(preservedGame.id);

    // The real bug: a fresh insert into either child table, referencing a
    // real (surviving) games row, must not throw "no such table". A second
    // payment row first, since (payment_id, game_id) is itself unique.
    const newPaymentId = Number(
      db
        .prepare(
          `INSERT INTO payments (local_uuid, customer_id, amount, method, paid_at, collected_by_user_id, shift_id)
           VALUES ('second-payment', 42, 50, 'cash', ?, 1, 1)`
        )
        .run(new Date().toISOString()).lastInsertRowid
    );
    expect(() =>
      db.prepare(`INSERT INTO payment_game_links (payment_id, game_id) VALUES (?, ?)`).run(newPaymentId, preservedGame.id)
    ).not.toThrow();
    // The rebuilt collateral_items now enforces its customer_id foreign key
    // for real (the minimal pre-migration schema above didn't), so this
    // insert needs an actual customer row rather than the placeholder 42
    // used above while foreign_keys was off.
    const realCustomerId = Number(
      db
        .prepare(`INSERT INTO customers (local_uuid, display_name, is_temporary, created_at, updated_at) VALUES (?, 'Test Customer', 0, ?, ?)`)
        .run("test-customer", new Date().toISOString(), new Date().toISOString()).lastInsertRowid
    );
    expect(() =>
      db
        .prepare(
          `INSERT INTO collateral_items (local_uuid, game_id, customer_id, item_description, held_by_user_id, held_at, updated_at)
           VALUES ('new-collateral', ?, ?, 'phone', 1, ?, ?)`
        )
        .run(preservedGame.id, realCustomerId, new Date().toISOString(), new Date().toISOString())
    ).not.toThrow();

    // The rebuild shouldn't have disturbed normal first-run seeding either.
    const tableCount = (db.prepare("SELECT COUNT(*) AS c FROM tables").get() as { c: number }).c;
    expect(tableCount).toBe(6);

    client.closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  });

  it("repairs an already-broken install where games was migrated but payment_game_links/collateral_items still dangle", async () => {
    // Simulate exactly what shipped briefly: the FIRST version of this
    // migration only rebuilt `games` itself, so an install that already ran
    // it once is left with games already nullable, but payment_game_links
    // and collateral_items still pointing their foreign key at the
    // (already-dropped) renamed table from that earlier run.
    const raw = new Database(dbPath);
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_uuid TEXT NOT NULL UNIQUE,
        server_id INTEGER,
        table_id INTEGER NOT NULL,
        game_type_id INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_actual_minutes REAL,
        duration_billed_minutes INTEGER,
        price_original INTEGER NOT NULL,
        discount_amount INTEGER NOT NULL DEFAULT 0,
        discount_reason TEXT,
        discount_by_id INTEGER,
        price_final INTEGER NOT NULL,
        loser_customer_id INTEGER,
        winner_customer_id INTEGER,
        payment_status TEXT NOT NULL,
        created_by_user_id INTEGER NOT NULL,
        shift_id INTEGER NOT NULL,
        reversed INTEGER NOT NULL DEFAULT 0,
        reversed_by_id INTEGER,
        reversed_reason TEXT,
        reversed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_uuid TEXT NOT NULL UNIQUE,
        server_id INTEGER,
        customer_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        method TEXT NOT NULL,
        note TEXT,
        paid_at TEXT NOT NULL,
        collected_by_user_id INTEGER NOT NULL,
        shift_id INTEGER NOT NULL
      );
      -- The dangling state itself: these reference a table that doesn't exist.
      CREATE TABLE payment_game_links (
        payment_id INTEGER NOT NULL REFERENCES payments (id),
        game_id    INTEGER NOT NULL REFERENCES games_pre_nullable_loser (id),
        PRIMARY KEY (payment_id, game_id)
      );
      CREATE TABLE collateral_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_uuid TEXT NOT NULL UNIQUE,
        server_id INTEGER,
        game_id INTEGER NOT NULL REFERENCES games_pre_nullable_loser (id),
        customer_id INTEGER NOT NULL,
        item_description TEXT NOT NULL,
        held_by_user_id INTEGER NOT NULL,
        held_at TEXT NOT NULL,
        returned INTEGER NOT NULL DEFAULT 0,
        returned_at TEXT,
        returned_by_user_id INTEGER,
        updated_at TEXT NOT NULL
      );
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
    raw
      .prepare(
        `INSERT INTO payments (local_uuid, customer_id, amount, method, paid_at, collected_by_user_id, shift_id)
         VALUES ('preexisting-payment', 42, 100, 'cash', ?, 1, 1)`
      )
      .run(now);
    raw.prepare(`INSERT INTO payment_game_links (payment_id, game_id) VALUES (1, 1)`).run();
    raw.close();

    vi.resetModules();
    const client = await import("./client");
    const db = client.getDb();

    const preservedGame = db.prepare(`SELECT * FROM games WHERE local_uuid = ?`).get("preexisting-game") as any;
    expect(preservedGame).toBeTruthy();

    const preservedLink = db.prepare(`SELECT * FROM payment_game_links WHERE game_id = ?`).get(preservedGame.id) as any;
    expect(preservedLink).toBeTruthy();

    const fks = db.prepare(`PRAGMA foreign_key_list(payment_game_links)`).all() as { table: string }[];
    expect(fks.every((fk) => fk.table === "games" || fk.table === "payments")).toBe(true);

    const newPaymentId = Number(
      db
        .prepare(
          `INSERT INTO payments (local_uuid, customer_id, amount, method, paid_at, collected_by_user_id, shift_id)
           VALUES ('second-payment', 42, 50, 'cash', ?, 1, 1)`
        )
        .run(new Date().toISOString()).lastInsertRowid
    );
    expect(() =>
      db.prepare(`INSERT INTO payment_game_links (payment_id, game_id) VALUES (?, ?)`).run(newPaymentId, preservedGame.id)
    ).not.toThrow();

    client.closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  });
});
