import type { GameTypeEntity, TableType } from "@snooker/shared";
import { getDb } from "../client";

function mapRow(row: any): GameTypeEntity {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    defaultDurationMinutes: row.default_duration_minutes,
    isActive: !!row.is_active,
  };
}

export function listGameTypes(): GameTypeEntity[] {
  const db = getDb();
  return (db.prepare(`SELECT * FROM game_types WHERE is_active = 1 ORDER BY id ASC`).all() as any[]).map(mapRow);
}

/**
 * Table 6 (private room) only offers the game types that have an active
 * pricing_rules row for `private_room` (spec §2.1 — private room has no "6
 * Ball (Double)" entry). Standard tables 1-5 show every active game type
 * with a `standard` pricing rule.
 */
export function listGameTypesForTableType(tableType: TableType): GameTypeEntity[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT gt.* FROM game_types gt
       JOIN pricing_rules pr ON pr.game_type_id = gt.id
       WHERE gt.is_active = 1 AND pr.table_type = ? AND pr.effective_to IS NULL
       ORDER BY gt.id ASC`
    )
    .all(tableType) as any[];
  return rows.map(mapRow);
}
