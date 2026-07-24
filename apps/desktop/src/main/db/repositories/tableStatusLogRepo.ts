/**
 * Vacancy tracking (spec §2.7). This table is LOCAL-ONLY / derived: per
 * docs/API_CONTRACT.md, "Table Status Log — Managed server-side
 * automatically whenever a game starts/ends ... no direct client writes."
 * The desktop keeps its own copy purely so the dashboard tiles and the local
 * utilization report work correctly while offline; rows here are never
 * pushed through sync_queue (the server recomputes the authoritative log
 * itself from the games it receives).
 */
import type Database from "better-sqlite3";
import type { TableStatusLogEntity } from "@snooker/shared";
import { computeUtilization, type UtilizationResult } from "@snooker/shared";
import { getDb } from "../client";

function mapRow(row: any): TableStatusLogEntity {
  return {
    id: row.id,
    tableId: row.table_id,
    status: row.status,
    statusFrom: row.status_from,
    statusTo: row.status_to,
  };
}

export function getCurrentStatus(db: Database.Database, tableId: number): "occupied" | "vacant" {
  const row = db
    .prepare(`SELECT status FROM table_status_log WHERE table_id = ? AND status_to IS NULL ORDER BY id DESC LIMIT 1`)
    .get(tableId) as { status: "occupied" | "vacant" } | undefined;
  return row?.status ?? "vacant";
}

/** Call inside the same transaction as the game-start write: closes the open vacant window, opens an occupied one. */
export function markOccupied(db: Database.Database, tableId: number, at: string): void {
  db.prepare(`UPDATE table_status_log SET status_to = ? WHERE table_id = ? AND status_to IS NULL`).run(at, tableId);
  db.prepare(`INSERT INTO table_status_log (table_id, status, status_from, status_to) VALUES (?, 'occupied', ?, NULL)`).run(
    tableId,
    at
  );
}

/** Call inside the same transaction as the game-end write: closes the occupied window, opens a fresh vacant one. */
export function markVacant(db: Database.Database, tableId: number, at: string): void {
  db.prepare(`UPDATE table_status_log SET status_to = ? WHERE table_id = ? AND status_to IS NULL`).run(at, tableId);
  db.prepare(`INSERT INTO table_status_log (table_id, status, status_from, status_to) VALUES (?, 'vacant', ?, NULL)`).run(
    tableId,
    at
  );
}

export function getUtilization(tableId: number, from: string, to: string): UtilizationResult {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM table_status_log
       WHERE table_id = ? AND status_from < ? AND (status_to IS NULL OR status_to > ?)
       ORDER BY status_from ASC`
    )
    .all(tableId, to, from) as any[];

  const windows = rows.map(mapRow).map((w) => ({
    status: w.status,
    statusFrom: new Date(w.statusFrom),
    statusTo: w.statusTo ? new Date(w.statusTo) : null,
  }));

  return computeUtilization(windows, new Date(to));
}

/**
 * "Where can I see when a table was free from X to Y" — the vacancy side of
 * the utilization log (spec §2.7), formatted for the Table Details screen:
 * every vacant window over the last `sinceDays`, most recent first, plus a
 * utilization summary for that span.
 */
export function getVacancyHistory(
  tableId: number,
  sinceDays = 30
): { windows: { from: string; to: string; durationMinutes: number }[]; totalVacantMinutes: number; totalOccupiedMinutes: number; utilizationPercent: number } {
  const now = new Date();
  const from = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000);
  const result = getUtilization(tableId, from.toISOString(), now.toISOString());

  const windows = [...result.vacantWindows]
    .sort((a, b) => b.from.getTime() - a.from.getTime())
    .map((w) => ({
      from: w.from.toISOString(),
      to: w.to.toISOString(),
      durationMinutes: Math.round((w.to.getTime() - w.from.getTime()) / 60000),
    }));

  return {
    windows,
    totalVacantMinutes: Math.round(result.vacantMinutes),
    totalOccupiedMinutes: Math.round(result.occupiedMinutes),
    utilizationPercent: Math.round(result.utilizationPercent * 10) / 10,
  };
}

/**
 * The dedicated Vacancy Log page — every table's vacancy history at once
 * (same "click a table" grid the Main Dashboard uses), visible to all staff
 * since it's operational information, not financial.
 */
export function getVacancyHistoryForAllTables(sinceDays = 30): {
  tableId: number;
  tableNumber: number;
  label: string;
  windows: { from: string; to: string; durationMinutes: number }[];
  totalVacantMinutes: number;
  totalOccupiedMinutes: number;
  utilizationPercent: number;
}[] {
  const db = getDb();
  const tables = db.prepare(`SELECT id, table_number, label FROM tables ORDER BY table_number ASC`).all() as {
    id: number;
    table_number: number;
    label: string;
  }[];

  return tables.map((t) => ({
    tableId: t.id,
    tableNumber: t.table_number,
    label: t.label,
    ...getVacancyHistory(t.id, sinceDays),
  }));
}
