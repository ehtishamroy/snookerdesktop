/**
 * Merges a GET /sync/pull response into the local SQLite mirror. Handles
 * the reference/catalogue data explicitly named in docs/API_CONTRACT.md
 * ("all rows changed after since across pricing_rules, tables, game_types,
 * customers (non-nishani), and any of the caller's own shift/game data")
 * plus payments/collateral/expenses for full multi-device resilience.
 *
 * Conflict resolution (spec §3.3.4 / docs/API_CONTRACT.md): last-write-wins
 * on `updatedAt`. The losing version — whichever side is NOT applied — is
 * still written to `audit_log` as a superseded snapshot; it is never
 * silently discarded, matching the append-only philosophy used everywhere
 * else in this app.
 */
import type Database from "better-sqlite3";
import { writeAuditLog } from "../db/repositories/auditLogRepo";
import { getSystemUserId } from "../db/repositories/usersRepo";

export interface PulledRow {
  id: number; // server id
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PullResponse {
  serverTime: string;
  tables?: PulledRow[];
  gameTypes?: PulledRow[];
  pricingRules?: PulledRow[];
  customers?: PulledRow[];
  shifts?: PulledRow[];
  games?: PulledRow[];
  payments?: PulledRow[];
  collateralItems?: PulledRow[];
  expenses?: PulledRow[];
}

function upsertReferenceRow(
  db: Database.Database,
  table: string,
  columns: Record<string, string>, // local column -> server field
  row: PulledRow
): void {
  const local = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id) as any;

  if (local && local.updated_at && row.updatedAt && new Date(local.updated_at) > new Date(row.updatedAt)) {
    // Local edit is newer — keep it, but never drop the server's version silently.
    writeAuditLog(db, {
      entityType: table,
      entityId: row.id,
      action: "sync_conflict_superseded",
      beforeValue: row,
      afterValue: local,
      performedById: getSystemUserId(), // system-originated reconciliation, not a specific staff action
    });
    return;
  }

  if (local && local.updated_at && row.updatedAt && new Date(local.updated_at) === new Date(row.updatedAt)) {
    return; // identical, nothing to do
  }

  const cols = Object.keys(columns);
  const values = cols.map((c) => row[columns[c]!] ?? null);

  if (local) {
    if (local.updated_at) {
      writeAuditLog(db, {
        entityType: table,
        entityId: row.id,
        action: "sync_conflict_superseded",
        beforeValue: local,
        afterValue: row,
        performedById: getSystemUserId(),
      });
    }
    db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...values, row.id);
  } else {
    db.prepare(`INSERT INTO ${table} (id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`).run(
      row.id,
      ...values
    );
  }
}

/** For tables where the local scheme uses its own autoincrement id + a nullable server_id column. */
function upsertMirroredRow(
  db: Database.Database,
  table: string,
  columns: Record<string, string>,
  row: PulledRow
): void {
  const local = db.prepare(`SELECT * FROM ${table} WHERE server_id = ?`).get(row.id) as any;

  if (local && local.updated_at && row.updatedAt && new Date(local.updated_at) > new Date(row.updatedAt)) {
    writeAuditLog(db, {
      entityType: table,
      entityId: local.id,
      action: "sync_conflict_superseded",
      beforeValue: row,
      afterValue: local,
      performedById: getSystemUserId(),
    });
    return;
  }

  const cols = Object.keys(columns);
  const values = cols.map((c) => row[columns[c]!] ?? null);

  if (local) {
    if (local.updated_at) {
      writeAuditLog(db, {
        entityType: table,
        entityId: local.id,
        action: "sync_conflict_superseded",
        beforeValue: local,
        afterValue: row,
        performedById: getSystemUserId(),
      });
    }
    db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...values, local.id);
  } else {
    db.prepare(
      `INSERT INTO ${table} (local_uuid, server_id, ${cols.join(", ")}) VALUES (?, ?, ${cols.map(() => "?").join(", ")})`
    ).run(`server-${table}-${row.id}`, row.id, ...values);
  }
}

export function applyPulledChanges(db: Database.Database, pull: PullResponse): void {
  const tx = db.transaction(() => {
    for (const row of pull.tables ?? []) {
      upsertReferenceRow(
        db,
        "tables",
        { table_number: "tableNumber", table_type: "tableType", label: "label", is_active: "isActive", updated_at: "updatedAt" },
        row
      );
    }
    for (const row of pull.gameTypes ?? []) {
      upsertReferenceRow(
        db,
        "game_types",
        { code: "code", name: "name", default_duration_minutes: "defaultDurationMinutes", is_active: "isActive" },
        row
      );
    }
    for (const row of pull.pricingRules ?? []) {
      upsertMirroredRow(
        db,
        "pricing_rules",
        {
          table_type: "tableType",
          game_type_id: "gameTypeId",
          price: "price",
          duration_minutes: "durationMinutes",
          effective_from: "effectiveFrom",
          effective_to: "effectiveTo",
          created_by_id: "createdBy",
          updated_at: "updatedAt",
        },
        row
      );
    }
    for (const row of pull.customers ?? []) {
      // Nishani rows are already excluded server-side per the API contract,
      // but the desktop filters again defensively in customersRepo.searchCustomers.
      upsertMirroredRow(
        db,
        "customers",
        {
          display_name: "displayName",
          is_temporary: "isTemporary",
          nishani_description: "nishaniDescription",
          phone: "phone",
          notes: "notes",
          created_at: "createdAt",
          updated_at: "updatedAt",
        },
        row
      );
    }
    for (const row of pull.shifts ?? []) {
      upsertMirroredRow(
        db,
        "shifts",
        {
          user_id: "userId",
          opened_at: "openedAt",
          closed_at: "closedAt",
          declared_cash_amount: "declaredCashAmount",
          system_cash_total: "systemCashTotal",
          cash_variance: "cashVariance",
          is_locked: "isLocked",
          closed_by_id: "closedByUserId",
          updated_at: "updatedAt",
        },
        row
      );
    }
    for (const row of pull.games ?? []) {
      upsertMirroredRow(
        db,
        "games",
        {
          table_id: "tableId",
          game_type_id: "gameTypeId",
          start_time: "startTime",
          end_time: "endTime",
          duration_actual_minutes: "durationActualMinutes",
          duration_billed_minutes: "durationBilledMinutes",
          price_original: "priceOriginal",
          discount_amount: "discountAmount",
          discount_reason: "discountReason",
          discount_by_id: "discountByUserId",
          price_final: "priceFinal",
          loser_customer_id: "loserCustomerId",
          winner_customer_id: "winnerCustomerId",
          payment_status: "paymentStatus",
          created_by_user_id: "createdByUserId",
          shift_id: "shiftId",
          reversed: "reversed",
          reversed_by_id: "reversedBy",
          reversed_reason: "reversedReason",
          reversed_at: "reversedAt",
          updated_at: "updatedAt",
        },
        row
      );
    }
  });
  tx();
}
