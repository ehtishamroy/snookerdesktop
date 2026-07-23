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
  db.pragma("foreign_keys = ON");

  db.exec(schemaSql);

  seedReferenceDataIfEmpty(db);

  return db;
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
