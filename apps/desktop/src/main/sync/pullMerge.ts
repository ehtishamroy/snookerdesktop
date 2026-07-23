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
 *
 * Foreign keys on an incoming row arrive expressed in the SERVER's ids (e.g.
 * a pulled game's `loserCustomerId` is a server id) and must be translated
 * back to this PC's local id (via entityMap.resolveLocalId) before the row
 * can be written locally — the reverse of what pushPayload.ts does when
 * pushing. A row whose FK can't yet be resolved locally (the referenced
 * row hasn't itself been synced/created on this PC) is skipped for this
 * cycle rather than written with a dangling reference.
 *
 * Known limitation: docs/API_CONTRACT.md's `/sync/pull` response is not
 * specified to include `users` at all (only pricing_rules, tables,
 * game_types, customers, and the caller's own shift/game data). Since every
 * *locally originated* write always already has correct local ids by
 * construction, this only matters for genuinely cross-device rows (e.g. two
 * PCs touching the same table, which spec §3.3.3 notes should be rare) whose
 * `createdByUserId`/`collectedByUserId`/etc. refers to a staff member never
 * seen on this PC — such a row is skipped (logged, not silently dropped)
 * until that gap is closed server-side.
 */
import type Database from "better-sqlite3";
import { writeAuditLog } from "../db/repositories/auditLogRepo";
import { getSystemUserId } from "../db/repositories/usersRepo";
import { resolveLocalId } from "../db/entityMap";
import { FK_FIELDS } from "./pushPayload";

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

function logSuperseded(db: Database.Database, table: string, entityId: number, before: unknown, after: unknown): void {
  writeAuditLog(db, {
    entityType: table,
    entityId,
    action: "sync_conflict_superseded",
    beforeValue: before,
    afterValue: after,
    performedById: getSystemUserId(), // system-originated reconciliation, not a specific staff action
  });
}

/** Translates every FK field this entity type carries from server ids to local ids. Returns null if a required FK can't be resolved yet. */
function resolveIncomingForeignKeys(
  db: Database.Database,
  entityType: string,
  row: PulledRow
): Record<string, unknown> | null {
  const resolved: Record<string, unknown> = { ...row };
  for (const fk of FK_FIELDS[entityType] ?? []) {
    const serverValue = row[fk.field];
    if (serverValue === null || serverValue === undefined) {
      if (!fk.nullable) return null;
      continue;
    }
    const localId = resolveLocalId(db, fk.refType, serverValue as number);
    if (localId === null) {
      if (!fk.nullable) return null;
      resolved[fk.field] = null;
      continue;
    }
    resolved[fk.field] = localId;
  }
  return resolved;
}

/** Reference/catalogue tables where the local id already IS the server id (tables, game_types). */
function upsertReferenceRow(db: Database.Database, table: string, columns: Record<string, string>, row: PulledRow): void {
  const local = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id) as any;

  if (local?.updated_at && row.updatedAt && new Date(local.updated_at) > new Date(row.updatedAt)) {
    logSuperseded(db, table, row.id, row, local); // local edit is newer — keep it, but never drop the server's version silently
    return;
  }
  if (local?.updated_at && row.updatedAt && new Date(local.updated_at).getTime() === new Date(row.updatedAt).getTime()) {
    return; // identical, nothing to do
  }

  const cols = Object.keys(columns);
  const values = cols.map((c) => row[columns[c]!] ?? null);

  if (local) {
    if (local.updated_at) logSuperseded(db, table, row.id, local, row);
    db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...values, row.id);
  } else {
    db.prepare(`INSERT INTO ${table} (id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`).run(row.id, ...values);
  }
}

/** Tables where the local scheme uses its own autoincrement id + a nullable server_id column, with FK translation. */
function upsertMirroredRow(db: Database.Database, entityType: string, columns: Record<string, string>, row: PulledRow): void {
  const resolved = resolveIncomingForeignKeys(db, entityType, row);
  if (!resolved) {
    // eslint-disable-next-line no-console
    console.warn(`[sync] Deferring pulled ${entityType} #${row.id} — a referenced row isn't known locally yet.`);
    return;
  }

  const local = db.prepare(`SELECT * FROM ${entityType} WHERE server_id = ?`).get(row.id) as any;

  if (local?.updated_at && resolved.updatedAt && new Date(local.updated_at) > new Date(resolved.updatedAt as string)) {
    logSuperseded(db, entityType, local.id, resolved, local);
    return;
  }

  const cols = Object.keys(columns);
  const values = cols.map((c) => resolved[columns[c]!] ?? null);

  if (local) {
    if (local.updated_at) logSuperseded(db, entityType, local.id, local, resolved);
    db.prepare(`UPDATE ${entityType} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...values, local.id);
  } else {
    db.prepare(
      `INSERT INTO ${entityType} (local_uuid, server_id, ${cols.join(", ")}) VALUES (?, ?, ${cols.map(() => "?").join(", ")})`
    ).run(`server-${entityType}-${row.id}`, row.id, ...values);
  }
}

const PRICING_RULE_COLUMNS = {
  table_type: "tableType",
  game_type_id: "gameTypeId",
  price: "price",
  duration_minutes: "durationMinutes",
  effective_from: "effectiveFrom",
  effective_to: "effectiveTo",
  created_by_id: "createdBy",
  updated_at: "updatedAt",
};

const CUSTOMER_COLUMNS = {
  display_name: "displayName",
  is_temporary: "isTemporary",
  nishani_description: "nishaniDescription",
  phone: "phone",
  notes: "notes",
  created_at: "createdAt",
  updated_at: "updatedAt",
};

const SHIFT_COLUMNS = {
  user_id: "userId",
  opened_at: "openedAt",
  closed_at: "closedAt",
  declared_cash_amount: "declaredCashAmount",
  system_cash_total: "systemCashTotal",
  cash_variance: "cashVariance",
  is_locked: "isLocked",
  closed_by_id: "closedByUserId",
  updated_at: "updatedAt",
};

const GAME_COLUMNS = {
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
};

const PAYMENT_COLUMNS = {
  customer_id: "customerId",
  amount: "amount",
  method: "method",
  note: "note",
  paid_at: "paidAt",
  collected_by_user_id: "collectedByUserId",
  shift_id: "shiftId",
};

const COLLATERAL_COLUMNS = {
  game_id: "gameId",
  customer_id: "customerId",
  item_description: "itemDescription",
  held_by_user_id: "heldByUserId",
  held_at: "heldAt",
  returned: "returned",
  returned_at: "returnedAt",
  returned_by_user_id: "returnedByUserId",
  updated_at: "updatedAt",
};

const EXPENSE_COLUMNS = {
  category: "category",
  amount: "amount",
  method: "method",
  note: "note",
  spent_at: "spentAt",
  recorded_by_user_id: "recordedByUserId",
  shift_id: "shiftId",
};

export function applyPulledChanges(db: Database.Database, pull: PullResponse): void {
  const tx = db.transaction(() => {
    for (const row of pull.tables ?? []) {
      upsertReferenceRow(db, "tables", {
        table_number: "tableNumber",
        table_type: "tableType",
        label: "label",
        is_active: "isActive",
        updated_at: "updatedAt",
      }, row);
    }
    for (const row of pull.gameTypes ?? []) {
      upsertReferenceRow(db, "game_types", {
        code: "code",
        name: "name",
        default_duration_minutes: "defaultDurationMinutes",
        is_active: "isActive",
      }, row);
    }
    // Order matters below: entities are applied in dependency order so a
    // same-cycle pull of e.g. a new customer AND a game referencing them
    // resolves correctly without needing a second pull.
    for (const row of pull.pricingRules ?? []) upsertMirroredRow(db, "pricing_rules", PRICING_RULE_COLUMNS, row);
    for (const row of pull.customers ?? []) {
      // Nishani rows are already excluded server-side per the API contract,
      // but the desktop filters again defensively in customersRepo.searchCustomers.
      upsertMirroredRow(db, "customers", CUSTOMER_COLUMNS, row);
    }
    for (const row of pull.shifts ?? []) upsertMirroredRow(db, "shifts", SHIFT_COLUMNS, row);
    for (const row of pull.games ?? []) upsertMirroredRow(db, "games", GAME_COLUMNS, row);
    for (const row of pull.payments ?? []) upsertMirroredRow(db, "payments", PAYMENT_COLUMNS, row);
    for (const row of pull.collateralItems ?? []) upsertMirroredRow(db, "collateral_items", COLLATERAL_COLUMNS, row);
    for (const row of pull.expenses ?? []) upsertMirroredRow(db, "expenses", EXPENSE_COLUMNS, row);
  });
  tx();
}
