/**
 * The single better-sqlite3 connection for the whole main process, plus
 * first-run schema migration and reference-data seeding. All repositories
 * import `getDb()` — there is intentionally only ever one open connection
 * (better-sqlite3 is synchronous and not designed for connection pooling).
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { hashPin } from "../auth";
// Vite's `?raw` suffix inlines the file's contents as a string constant at
// build time — this avoids fragile __dirname-relative fs reads that would
// otherwise break depending on how the main process bundle is flattened.
import schemaSql from "./schema.sql?raw";

let db: Database.Database | null = null;

function resolveDbPath(): string {
  // Allow override for tests / a portable install; default to Electron's
  // per-user application data directory (e.g. %APPDATA%/snooker-counter on
  // Windows), which survives app updates and is per-Windows-user.
  if (process.env.SNOOKER_DB_PATH) return process.env.SNOOKER_DB_PATH;
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "snooker-counter.sqlite3");
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = resolveDbPath();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  // foreign_keys stays off (better-sqlite3's default) through migration/schema
  // setup/seeding — a mid-rebuild table rename can leave other tables'
  // foreign key definitions transiently pointed at the renamed name, which
  // enforcement would otherwise reject. Turned on only once everything below
  // has settled into its final, consistent shape.
  migrateGamesLoserNullable(db);
  repairDanglingGameChildForeignKeys(db);
  migrateExpenseEditTracking(db);
  db.exec(schemaSql);

  seedReferenceDataIfEmpty(db);

  db.pragma("foreign_keys = ON");

  return db;
}

/**
 * Installs from before games.loser_customer_id became nullable (a player's
 * name is now optional at game-start and can be added during/after the
 * round instead) still have the old NOT NULL constraint baked into their
 * on-disk `games` table — schema.sql's `CREATE TABLE IF NOT EXISTS` can't
 * fix that retroactively. SQLite has no ALTER COLUMN, so rebuild the table
 * (rename, let schema.sql recreate it fresh with the new column
 * definition, copy the old rows across, drop the rename) rather than
 * losing whoever already has games recorded locally.
 *
 * Renaming `games` here has a side effect handled separately, by
 * `repairDanglingGameChildForeignKeys` below: SQLite silently rewrites any
 * OTHER table's foreign key clause that points at `games`
 * (payment_game_links.game_id, collateral_items.game_id) to point at the
 * renamed name instead, which goes dangling once that renamed table is
 * dropped at the end of this function.
 */
function migrateGamesLoserNullable(database: Database.Database): void {
  const gamesExists = database
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'games'`)
    .get();
  if (!gamesExists) return;

  const columns = database.prepare(`PRAGMA table_info(games)`).all() as { name: string; notnull: number }[];
  const loserColumn = columns.find((c) => c.name === "loser_customer_id");
  if (!loserColumn || loserColumn.notnull === 0) return;

  // better-sqlite3 defaults foreign_keys to ON, which would otherwise reject
  // the rename/rebuild below while other tables' FK definitions transiently
  // point at whatever "games" is renamed to. getDb() doesn't turn it on
  // until after this migration runs, but be explicit rather than rely on that.
  database.pragma("foreign_keys = OFF");
  database.exec(`
    DROP INDEX IF EXISTS idx_games_loser_status;
    DROP INDEX IF EXISTS idx_games_table_start;
    DROP INDEX IF EXISTS idx_games_open;
    ALTER TABLE games RENAME TO games_pre_nullable_loser;
  `);
  database.exec(schemaSql);
  database.exec(`
    INSERT INTO games SELECT * FROM games_pre_nullable_loser;
    DROP TABLE games_pre_nullable_loser;
  `);
}

function tableExists(database: Database.Database, name: string): boolean {
  return !!database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

/**
 * Self-healing pass for the fallout described above: if payment_game_links
 * or collateral_items currently have a foreign key pointing at a table that
 * doesn't exist (either from the rename this same run just did, or from an
 * install that already went through that rename in a previous, buggier
 * version of this migration), rebuild just those two tables so their
 * foreign key points at the real `games` table again. Runs unconditionally
 * and is a cheap no-op — a couple of PRAGMA lookups — when nothing is wrong.
 */
function repairDanglingGameChildForeignKeys(database: Database.Database): void {
  const targets: { table: string; indexDropSql?: string }[] = [
    { table: "payment_game_links" },
    { table: "collateral_items", indexDropSql: "DROP INDEX IF EXISTS idx_collateral_customer;" },
  ];

  const toRebuild = targets.filter((t) => {
    if (!tableExists(database, t.table)) return false;
    const fks = database.prepare(`PRAGMA foreign_key_list(${t.table})`).all() as { table: string }[];
    return fks.some((fk) => !tableExists(database, fk.table));
  });
  if (toRebuild.length === 0) return;

  database.pragma("foreign_keys = OFF");
  for (const t of toRebuild) {
    if (t.indexDropSql) database.exec(t.indexDropSql);
    database.exec(`ALTER TABLE ${t.table} RENAME TO ${t.table}_dangling_fk_fix;`);
  }

  database.exec(schemaSql);

  for (const t of toRebuild) {
    database.exec(`
      INSERT INTO ${t.table} SELECT * FROM ${t.table}_dangling_fk_fix;
      DROP TABLE ${t.table}_dangling_fk_fix;
    `);
  }
}

/**
 * Installs from before expense edit-tracking existed are missing the
 * edited/edited_at/edited_by_id columns. Unlike the games rebuild above,
 * SQLite's `ALTER TABLE ADD COLUMN` handles this directly — no rename/copy
 * dance needed, since nothing else references these new columns via FK.
 */
function migrateExpenseEditTracking(database: Database.Database): void {
  const expensesExists = tableExists(database, "expenses");
  if (!expensesExists) return;

  const columns = database.prepare(`PRAGMA table_info(expenses)`).all() as { name: string }[];
  if (columns.some((c) => c.name === "edited")) return;

  database.exec(`
    ALTER TABLE expenses ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE expenses ADD COLUMN edited_at TEXT;
    ALTER TABLE expenses ADD COLUMN edited_by_id INTEGER REFERENCES users (id);
  `);
}

/**
 * Seeds the 6 physical tables, the 5 game types, their launch pricing (per
 * spec §2.1), and a bootstrap owner account (username "owner", PIN "0000")
 * so a brand-new install is usable before the first sync ever completes.
 * The bootstrap owner should change their PIN immediately from Admin
 * Settings — this is documented in the README.
 */
function seedReferenceDataIfEmpty(database: Database.Database): void {
  const tableCount = (database.prepare("SELECT COUNT(*) AS c FROM tables").get() as { c: number }).c;
  if (tableCount > 0) return;

  const now = new Date().toISOString();

  const insertTable = database.prepare(
    "INSERT INTO tables (id, table_number, table_type, label, is_active, updated_at) VALUES (?, ?, ?, ?, 1, ?)"
  );
  const insertGameType = database.prepare(
    "INSERT INTO game_types (id, code, name, default_duration_minutes, is_active) VALUES (?, ?, ?, ?, 1)"
  );
  const insertUser = database.prepare(
    "INSERT INTO users (local_uuid, full_name, username, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"
  );
  const insertPricingRule = database.prepare(
    `INSERT INTO pricing_rules (local_uuid, table_type, game_type_id, price, duration_minutes, effective_from, effective_to, created_by_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  );
  const insertVacantWindow = database.prepare(
    `INSERT INTO table_status_log (table_id, status, status_from, status_to) VALUES (?, 'vacant', ?, NULL)`
  );

  const seedTransaction = database.transaction(() => {
    for (let n = 1; n <= 5; n++) {
      insertTable.run(n, n, "standard", `Table ${n}`, now);
      insertVacantWindow.run(n, now);
    }
    insertTable.run(6, 6, "private_room", "Table 6 — Private Room", now);
    insertVacantWindow.run(6, now);

    const gameTypes: { id: number; code: string; name: string; duration: number }[] = [
      { id: 1, code: "6_ball", name: "6 Ball", duration: 25 },
      { id: 2, code: "6_ball_double", name: "6 Ball (Double)", duration: 25 },
      { id: 3, code: "full_frame", name: "Full Frame", duration: 25 },
      { id: 4, code: "full_frame_double", name: "Full Frame (Double)", duration: 25 },
      { id: 5, code: "century", name: "Century", duration: 60 },
    ];
    for (const gt of gameTypes) {
      insertGameType.run(gt.id, gt.code, gt.name, gt.duration);
    }

    const ownerResult = insertUser.run(
      randomUUID(),
      "Owner",
      "owner",
      "owner",
      hashPin("0000"),
      now,
      now
    );
    const ownerId = Number(ownerResult.lastInsertRowid);

    // A deactivated, unlisted "system" account used only to attribute
    // automated audit_log entries (e.g. sync-conflict superseded snapshots)
    // that no human staff member performed — see sync/pullMerge.ts. It can
    // never log in (is_active = 0, random unguessable PIN) and is filtered
    // out of usersRepo.listUsers()'s staff-management view.
    database
      .prepare(
        "INSERT INTO users (local_uuid, full_name, username, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)"
      )
      .run(randomUUID(), "System (Sync Engine)", "__system__", "owner", hashPin(randomUUID()), now, now);

    // Standard tables 1-5 price list (spec §2.1)
    const standardPrices: { gameTypeId: number; price: number; duration: number }[] = [
      { gameTypeId: 1, price: 100, duration: 25 },
      { gameTypeId: 2, price: 200, duration: 25 },
      { gameTypeId: 3, price: 150, duration: 25 },
      { gameTypeId: 4, price: 300, duration: 25 },
      { gameTypeId: 5, price: 600, duration: 60 },
    ];
    for (const p of standardPrices) {
      insertPricingRule.run(randomUUID(), "standard", p.gameTypeId, p.price, p.duration, now, ownerId, now);
    }

    // Private room (Table 6) price list (spec §2.1) — 6 Ball has no fixed
    // duration in the spec table; treated as the same 25-min block as the
    // other private-room game types for billing purposes.
    const privatePrices: { gameTypeId: number; price: number; duration: number }[] = [
      { gameTypeId: 1, price: 250, duration: 25 },
      { gameTypeId: 3, price: 250, duration: 25 },
      { gameTypeId: 4, price: 500, duration: 25 },
      { gameTypeId: 5, price: 1000, duration: 60 },
    ];
    for (const p of privatePrices) {
      insertPricingRule.run(randomUUID(), "private_room", p.gameTypeId, p.price, p.duration, now, ownerId, now);
    }
  });

  seedTransaction();
}

export function closeDb(): void {
  db?.close();
  db = null;
}
