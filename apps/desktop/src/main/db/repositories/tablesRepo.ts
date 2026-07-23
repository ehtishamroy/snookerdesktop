import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { TableEntity, TableType } from "@snooker/shared";
import { getDb } from "../client";
import { enqueueSyncWrite } from "./syncQueueRepo";
import { writeAuditLog } from "./auditLogRepo";

function mapRow(row: any): TableEntity {
  return {
    id: row.id,
    tableNumber: row.table_number,
    tableType: row.table_type,
    label: row.label,
    isActive: !!row.is_active,
  };
}

export function listTables(): TableEntity[] {
  const db = getDb();
  return (db.prepare(`SELECT * FROM tables ORDER BY table_number ASC`).all() as any[]).map(mapRow);
}

export function getTableById(db: Database.Database, id: number): TableEntity {
  const row = db.prepare(`SELECT * FROM tables WHERE id = ?`).get(id);
  if (!row) throw new Error(`Table ${id} not found`);
  return mapRow(row);
}

/**
 * Owner-only admin toggle (decision #8): a table is simply active/inactive —
 * there is no "maintenance" status. Deactivating a table hides it from being
 * started on but does not touch its occupied/vacant history.
 */
export function setTableActive(input: { tableId: number; isActive: boolean; performedByUserId: number }): TableEntity {
  const db = getDb();
  const tx = db.transaction(() => {
    const before = getTableById(db, input.tableId);
    db.prepare(`UPDATE tables SET is_active = ?, updated_at = ? WHERE id = ?`).run(
      input.isActive ? 1 : 0,
      new Date().toISOString(),
      input.tableId
    );
    const after = getTableById(db, input.tableId);
    enqueueSyncWrite(db, { localUuid: randomUUID(), entityType: "tables", operation: "update", payload: after });
    writeAuditLog(db, {
      entityType: "tables",
      entityId: input.tableId,
      action: "update",
      beforeValue: before,
      afterValue: after,
      performedById: input.performedByUserId,
    });
    return after;
  });
  return tx();
}

export function filterTablesByType(tableType: TableType): TableEntity[] {
  return listTables().filter((t) => t.tableType === tableType);
}
