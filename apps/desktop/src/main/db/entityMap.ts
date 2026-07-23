/**
 * Local-id <-> server-id resolution used by the sync engine when it needs to
 * translate a locally-created row's foreign keys (e.g. a game's
 * `loserCustomerId`) into the id the cloud backend actually knows about,
 * right before pushing that operation.
 *
 * `tables` and `game_types` are reference/catalogue data seeded with the
 * server's own ids (see db/schema.sql header comment) — for those, the local
 * id already IS the server id, so resolution is the identity function.
 * Every other syncable table carries its own nullable `server_id` column,
 * populated once the cloud backend confirms that row's push.
 */
import type Database from "better-sqlite3";

const IDENTITY_ENTITY_TYPES = new Set(["tables", "game_types"]);

const TABLE_BY_ENTITY_TYPE: Record<string, string> = {
  users: "users",
  pricing_rules: "pricing_rules",
  customers: "customers",
  shifts: "shifts",
  games: "games",
  payments: "payments",
  collateral_items: "collateral_items",
  expenses: "expenses",
  audit_log: "audit_log",
};

export function resolveServerId(db: Database.Database, entityType: string, localId: number): number | null {
  if (IDENTITY_ENTITY_TYPES.has(entityType)) return localId;
  const table = TABLE_BY_ENTITY_TYPE[entityType];
  if (!table) throw new Error(`Unknown syncable entity type: ${entityType}`);
  const row = db.prepare(`SELECT server_id FROM ${table} WHERE id = ?`).get(localId) as
    | { server_id: number | null }
    | undefined;
  return row?.server_id ?? null;
}

export function setServerId(db: Database.Database, entityType: string, localId: number, serverId: number): void {
  if (IDENTITY_ENTITY_TYPES.has(entityType)) return; // identity mapping, nothing to store
  const table = TABLE_BY_ENTITY_TYPE[entityType];
  if (!table) throw new Error(`Unknown syncable entity type: ${entityType}`);
  db.prepare(`UPDATE ${table} SET server_id = ? WHERE id = ?`).run(serverId, localId);
}
