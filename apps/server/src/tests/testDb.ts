/**
 * A minimal, dependency-free in-memory stand-in for PrismaClient, used by
 * the unit tests in this directory.
 *
 * Every service in src/services/* takes its `PrismaClient` (or
 * `Prisma.TransactionClient`) as an explicit parameter rather than
 * importing the singleton internally — a deliberate dependency-injection
 * choice specifically so the core business logic (pricing resolution,
 * billing, ledger, Z-report assembly, merge/purge) can be exercised here
 * against plain objects, with no real Postgres required. See
 * apps/server/README.md for how to instead run the full integration suite
 * against a real Postgres.
 *
 * This is NOT a general Prisma re-implementation — it only supports the
 * where-clause shapes and methods the services in this repo actually issue
 * (equality, in/not/gt/gte/lt/lte, contains, top-level OR, simple
 * find/create/update/updateMany/deleteMany/aggregate/groupBy). It also
 * mirrors the two pieces of real Postgres behavior the tests specifically
 * rely on: `@updatedAt` bumping on every `update`, and the
 * `onDelete: SetNull` behavior wired up on Game/Payment/CollateralItem's
 * customer relations (see schema.prisma) when a Customer row is deleted.
 */

type Row = Record<string, any>;

// A JSON round-trip clone would turn Date instances into strings, which
// breaks any service code that calls .getTime()/.toISOString() on a value
// read back from the fake DB (real Prisma always returns actual Date
// objects for DateTime columns). Clone recursively instead, preserving Date
// instances as Dates.
function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => clone(v)) as unknown as T;
  if (typeof value === "object") {
    const out: Row = {};
    for (const [k, v] of Object.entries(value as Row)) out[k] = clone(v);
    return out as T;
  }
  return value;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as any).getTime() === new Date(b as any).getTime();
  }
  return a === b;
}

function matchesCondition(val: unknown, cond: unknown): boolean {
  if (cond === null) return val === null || val === undefined;
  if (typeof cond !== "object" || cond instanceof Date) return isEqual(val, cond);
  const c = cond as Record<string, unknown>;
  let ok = true;
  if ("equals" in c) ok &&= isEqual(val, c.equals);
  if ("not" in c) ok &&= !matchesCondition(val, c.not);
  if ("in" in c) ok &&= (c.in as unknown[]).some((x) => isEqual(val, x));
  if ("gt" in c) ok &&= val !== null && val !== undefined && (val as any) > (c.gt as any);
  if ("gte" in c) ok &&= val !== null && val !== undefined && (val as any) >= (c.gte as any);
  if ("lt" in c) ok &&= val !== null && val !== undefined && (val as any) < (c.lt as any);
  if ("lte" in c) ok &&= val !== null && val !== undefined && (val as any) <= (c.lte as any);
  if ("contains" in c) {
    // We only ever use `mode: "insensitive"` in this codebase (customer
    // search), so case-insensitive contains is the only behavior needed.
    ok &&= String(val ?? "").toLowerCase().includes(String(c.contains).toLowerCase());
  }
  return ok;
}

export function matchesWhere(row: Row, where?: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Row[]).some((sub) => matchesWhere(row, sub));
    if (key === "AND") return (cond as Row[]).every((sub) => matchesWhere(row, sub));
    return matchesCondition(row[key], cond);
  });
}

interface RelationConfig {
  [field: string]: { store: string; fk: string; many?: boolean };
}

class FakeModel {
  rows: Row[] = [];
  private nextId = 1;

  constructor(
    private readonly db: FakeDb,
    private readonly name: string,
    private readonly defaults: (data: Row) => Row,
    private readonly relations: RelationConfig = {}
  ) {}

  private attachRelations(row: Row, include?: Row): Row {
    if (!include) return clone(row);
    const result = clone(row);
    for (const field of Object.keys(include)) {
      const rel = this.relations[field];
      if (!rel) continue;
      const relModel = this.db.model(rel.store);
      if (rel.many) {
        result[field] = relModel.rows.filter((r) => r[rel.fk] === row.id).map((r) => clone(r));
      } else {
        const fkVal = row[rel.fk];
        const found = fkVal == null ? null : relModel.rows.find((r) => r.id === fkVal);
        result[field] = found ? clone(found) : null;
      }
    }
    return result;
  }

  async findUnique({ where, include }: { where: Row; include?: Row }): Promise<Row | null> {
    const found = this.rows.find((r) => matchesWhere(r, where));
    return found ? this.attachRelations(found, include) : null;
  }

  async findUniqueOrThrow(args: { where: Row; include?: Row }): Promise<Row> {
    const found = await this.findUnique(args);
    if (!found) throw new Error(`${this.name} not found for ${JSON.stringify(args.where)}`);
    return found;
  }

  async findFirst({ where, orderBy, include }: { where?: Row; orderBy?: Row; include?: Row } = {}): Promise<Row | null> {
    const matched = this.rows.filter((r) => matchesWhere(r, where));
    const sorted = sortRows(matched, orderBy);
    return sorted[0] ? this.attachRelations(sorted[0], include) : null;
  }

  async findMany({
    where,
    orderBy,
    take,
    distinct,
    include,
  }: { where?: Row; orderBy?: Row; take?: number; distinct?: string[]; include?: Row } = {}): Promise<Row[]> {
    let matched = this.rows.filter((r) => matchesWhere(r, where));
    matched = sortRows(matched, orderBy);
    if (distinct && distinct.length > 0) {
      const seen = new Set<string>();
      matched = matched.filter((r) => {
        const key = distinct.map((f) => r[f]).join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (take) matched = matched.slice(0, take);
    return matched.map((r) => this.attachRelations(r, include));
  }

  /** Splits a Prisma-style `data` object into plain scalar fields and any
   * nested `{ create: [...] }` relation writes (e.g. Payment's
   * `gameLinks: { create: [...] }`), which get written to the related
   * store separately after the parent row exists. */
  private splitNestedWrites(data: Row): { plain: Row; nested: [string, Row[]][] } {
    const plain: Row = {};
    const nested: [string, Row[]][] = [];
    for (const [k, v] of Object.entries(data)) {
      if (this.relations[k] && v && typeof v === "object" && Array.isArray((v as Row).create)) {
        nested.push([k, (v as Row).create]);
      } else {
        plain[k] = v;
      }
    }
    return { plain, nested };
  }

  async create({ data, include }: { data: Row; include?: Row }): Promise<Row> {
    const { plain, nested } = this.splitNestedWrites(data);
    const row = this.defaults({ id: this.nextId++, ...plain });
    this.rows.push(row);

    for (const [field, children] of nested) {
      const rel = this.relations[field]!;
      const relModel = this.db.model(rel.store);
      for (const child of children) {
        await relModel.create({ data: { ...child, [rel.fk]: row.id } });
      }
    }

    return this.attachRelations(row, include);
  }

  async update({ where, data }: { where: Row; data: Row }): Promise<Row> {
    const idx = this.rows.findIndex((r) => matchesWhere(r, where));
    if (idx === -1) throw new Error(`${this.name} not found for update ${JSON.stringify(where)}`);
    const current = this.rows[idx]!;
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) current[k] = v;
    }
    if ("updatedAt" in current) current.updatedAt = new Date();
    return clone(current);
  }

  async updateMany({ where, data }: { where: Row; data: Row }): Promise<{ count: number }> {
    let count = 0;
    for (const row of this.rows) {
      if (matchesWhere(row, where)) {
        for (const [k, v] of Object.entries(data)) {
          if (v !== undefined) row[k] = v;
        }
        if ("updatedAt" in row) row.updatedAt = new Date();
        count++;
      }
    }
    return { count };
  }

  async deleteMany({ where }: { where: Row }): Promise<{ count: number }> {
    const toDelete = this.rows.filter((r) => matchesWhere(r, where));
    const ids = new Set(toDelete.map((r) => r.id));
    this.rows = this.rows.filter((r) => !ids.has(r.id));
    // Mirror onDelete: SetNull for the customer relations declared in
    // schema.prisma (Game.loserCustomer/winnerCustomer, Payment.customer,
    // CollateralItem.customer) so purge-job tests exercise the same
    // referential-integrity behavior Postgres would apply.
    if (this.name === "customer") {
      const game = this.db.model("game");
      const payment = this.db.model("payment");
      const collateralItem = this.db.model("collateralItem");
      for (const row of game.rows) {
        if (ids.has(row.loserCustomerId)) row.loserCustomerId = null;
        if (ids.has(row.winnerCustomerId)) row.winnerCustomerId = null;
      }
      for (const row of payment.rows) {
        if (ids.has(row.customerId)) row.customerId = null;
      }
      for (const row of collateralItem.rows) {
        if (ids.has(row.customerId)) row.customerId = null;
      }
    }
    return { count: ids.size };
  }

  async aggregate({ where, _sum, _count }: { where?: Row; _sum?: Row; _count?: Row }): Promise<Row> {
    const matched = this.rows.filter((r) => matchesWhere(r, where));
    const result: Row = {};
    if (_sum) {
      result._sum = {};
      for (const field of Object.keys(_sum)) {
        result._sum[field] = matched.reduce((sum, r) => sum + (r[field] ?? 0), 0);
      }
    }
    if (_count) {
      result._count = { _all: matched.length };
    }
    return result;
  }

  async groupBy({ by, where, _sum, _count }: { by: string[]; where?: Row; _sum?: Row; _count?: Row }): Promise<Row[]> {
    const matched = this.rows.filter((r) => matchesWhere(r, where));
    const groups = new Map<string, Row[]>();
    for (const row of matched) {
      const key = by.map((f) => row[f]).join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    const results: Row[] = [];
    for (const groupRows of groups.values()) {
      const entry: Row = {};
      for (const f of by) entry[f] = groupRows[0]![f];
      if (_sum) {
        entry._sum = {};
        for (const field of Object.keys(_sum)) {
          entry._sum[field] = groupRows.reduce((sum, r) => sum + (r[field] ?? 0), 0);
        }
      }
      if (_count) entry._count = { _all: groupRows.length };
      results.push(entry);
    }
    return results;
  }
}

function sortRows(rows: Row[], orderBy?: Row): Row[] {
  if (!orderBy) return rows;
  const [field, dir] = Object.entries(orderBy)[0] as [string, "asc" | "desc"];
  const sorted = [...rows].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av === bv) return 0;
    return av > bv ? 1 : -1;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

export class FakeDb {
  user = new FakeModel(this, "user", (d) => ({ isActive: true, createdAt: new Date(), ...d }));
  table = new FakeModel(this, "table", (d) => ({ isActive: true, ...d }));
  gameType = new FakeModel(this, "gameType", (d) => ({ isActive: true, ...d }));
  pricingRule = new FakeModel(this, "pricingRule", (d) => ({ effectiveTo: null, ...d }));
  customer = new FakeModel(this, "customer", (d) => ({
    isTemporary: false,
    mergedIntoCustomerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...d,
  }));
  shift = new FakeModel(
    this,
    "shift",
    (d) => ({
      openedAt: new Date(),
      closedAt: null,
      declaredCashAmount: null,
      systemCashTotal: null,
      cashVariance: null,
      isLocked: false,
      closedById: null,
      ...d,
    }),
    { user: { store: "user", fk: "userId" } }
  );
  game = new FakeModel(
    this,
    "game",
    (d) => ({
      discountAmount: 0,
      discountReason: null,
      discountById: null,
      winnerCustomerId: null,
      endTime: null,
      durationActualMinutes: null,
      durationBilledMinutes: null,
      reversed: false,
      reversedById: null,
      reversedReason: null,
      reversedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...d,
    }),
    {
      table: { store: "table", fk: "tableId" },
      gameType: { store: "gameType", fk: "gameTypeId" },
      loserCustomer: { store: "customer", fk: "loserCustomerId" },
      winnerCustomer: { store: "customer", fk: "winnerCustomerId" },
      createdBy: { store: "user", fk: "createdByUserId" },
    }
  );
  payment = new FakeModel(
    this,
    "payment",
    (d) => ({ note: null, paidAt: new Date(), ...d }),
    { gameLinks: { store: "paymentGameLink", fk: "paymentId", many: true } }
  );
  paymentGameLink = new FakeModel(this, "paymentGameLink", (d) => ({ ...d }));
  collateralItem = new FakeModel(this, "collateralItem", (d) => ({
    heldAt: new Date(),
    returned: false,
    returnedAt: null,
    returnedByUserId: null,
    ...d,
  }));
  expense = new FakeModel(this, "expense", (d) => ({ note: null, spentAt: new Date(), ...d }));
  auditLog = new FakeModel(this, "auditLog", (d) => ({ performedAt: new Date(), ...d }));
  tableStatusLog = new FakeModel(this, "tableStatusLog", (d) => ({ statusTo: null, ...d }));

  model(name: string): FakeModel {
    const model = (this as unknown as Record<string, FakeModel | undefined>)[name];
    if (!model) throw new Error(`Unknown fake model: ${name}`);
    return model;
  }

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    // No real rollback semantics — good enough for these unit tests, which
    // only assert on the happy path and on thrown errors (not partial
    // writes). Real atomicity is provided by Postgres in production.
    return fn(this);
  }
}

export function createTestDb(): FakeDb {
  return new FakeDb();
}
