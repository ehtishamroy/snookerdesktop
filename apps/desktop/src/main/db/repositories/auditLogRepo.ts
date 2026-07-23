import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AuditLogEntity } from "@snooker/shared";
import { enqueueSyncWrite } from "./syncQueueRepo";

interface WriteAuditLogInput {
  entityType: string;
  entityId: number;
  action: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  performedById: number;
}

function mapRow(row: any): AuditLogEntity {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    beforeValue: row.before_value ? JSON.parse(row.before_value) : null,
    afterValue: row.after_value ? JSON.parse(row.after_value) : null,
    performedBy: row.performed_by_id,
    performedAt: row.performed_at,
  };
}

/** Must be called from inside the caller's own write transaction (append-only, never updated). */
export function writeAuditLog(db: Database.Database, input: WriteAuditLogInput): AuditLogEntity {
  const localUuid = randomUUID();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO audit_log (local_uuid, entity_type, entity_id, action, before_value, after_value, performed_by_id, performed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      localUuid,
      input.entityType,
      input.entityId,
      input.action,
      input.beforeValue !== undefined ? JSON.stringify(input.beforeValue) : null,
      input.afterValue !== undefined ? JSON.stringify(input.afterValue) : null,
      input.performedById,
      now
    );
  const row = db.prepare(`SELECT * FROM audit_log WHERE id = ?`).get(Number(result.lastInsertRowid));
  const entity = mapRow(row);
  enqueueSyncWrite(db, { localUuid, entityType: "audit_log", operation: "insert", payload: entity });
  return entity;
}

export function getAuditLog(
  db: Database.Database,
  filter: { entityType?: string; entityId?: number; from?: string; to?: string }
): AuditLogEntity[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.entityType) {
    clauses.push("entity_type = ?");
    params.push(filter.entityType);
  }
  if (filter.entityId !== undefined) {
    clauses.push("entity_id = ?");
    params.push(filter.entityId);
  }
  if (filter.from) {
    clauses.push("performed_at >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("performed_at <= ?");
    params.push(filter.to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY performed_at DESC LIMIT 500`).all(...params);
  return rows.map(mapRow);
}
