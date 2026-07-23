import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { AuditAction } from "@snooker/shared";

/**
 * Shared audit-log helper (behavioral requirement #3). Every mutating
 * endpoint — create/update/reverse/merge/return-collateral/shift-open/
 * shift-close and friends — must call this instead of writing to
 * `audit_log` directly, so the shape of the record (and the fact that it's
 * *never* skipped) doesn't drift between services.
 *
 * `db` accepts either the top-level PrismaClient or a `$transaction`
 * callback client (`Prisma.TransactionClient`), so a mutation and its audit
 * row can be written atomically wherever that matters (e.g. reversing a
 * game and logging it must both succeed or both roll back).
 */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntryInput {
  entityType: string;
  entityId: number;
  action: AuditAction | (string & {});
  performedById: number;
  beforeValue?: unknown;
  afterValue?: unknown;
}

export async function writeAuditLog(db: Db, entry: AuditEntryInput): Promise<void> {
  await db.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      performedById: entry.performedById,
      beforeValue: toJson(entry.beforeValue),
      afterValue: toJson(entry.afterValue),
    },
  });
}

/** Prisma's Json columns reject `undefined`; normalize it to Prisma's JsonNull sentinel-free `null`. */
function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value));
}
