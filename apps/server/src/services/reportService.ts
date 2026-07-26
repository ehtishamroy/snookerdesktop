import type { PrismaClient } from "@prisma/client";
import { checkIdleAlert, computeUtilization, PAYMENT_METHODS, type TableStatusWindow } from "@snooker/shared";

export interface DateRange {
  from: Date;
  to: Date;
}

export function resolveDateRange(from?: string, to?: string): DateRange {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: fromDate, to: toDate };
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

function zeroMethodTotals(): Record<string, number> {
  return Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0]));
}

export async function getRevenueReport(
  prisma: PrismaClient,
  opts: { tableId?: number; from: Date; to: Date }
) {
  const gameWhere = {
    reversed: false,
    endTime: { not: null },
    startTime: { gte: opts.from, lte: opts.to },
    ...(opts.tableId ? { tableId: opts.tableId } : {}),
  };

  const games = await prisma.game.findMany({
    where: gameWhere,
    select: {
      tableId: true,
      paymentStatus: true,
      priceFinal: true,
      startTime: true,
      table: { select: { tableNumber: true, label: true, tableType: true } },
    },
  });

  // Payments settle rounds after the fact and can span multiple
  // games/tables/days in one "losing chain" settlement, so there's no exact
  // per-day/per-table payment-method attribution without much heavier
  // bookkeeping. Each day's/table's method split is approximated by scaling
  // that slice's revenue against the overall method proportions for the
  // whole range — useful for a reconciliation-style breakdown without
  // pretending to a precision the data doesn't actually support.
  const payments = await prisma.payment.findMany({
    where: { paidAt: { gte: opts.from, lte: opts.to } },
    select: { method: true, amount: true },
  });
  const overallByMethod = zeroMethodTotals();
  for (const p of payments) overallByMethod[p.method] = (overallByMethod[p.method] ?? 0) + p.amount;
  const overallCollected = payments.reduce((sum, p) => sum + p.amount, 0);

  function proportionalByMethod(amount: number): Record<string, number> {
    if (overallCollected === 0) return zeroMethodTotals();
    const result: Record<string, number> = {};
    for (const [m, methodTotal] of Object.entries(overallByMethod)) {
      result[m] = Math.round((methodTotal / overallCollected) * amount);
    }
    return result;
  }

  const daysInRange = daysBetween(opts.from, opts.to);

  const overallByStatus: Record<string, { count: number; total: number }> = {};
  const overallDays = new Map<string, number>();
  const perTableMap = new Map<
    number,
    {
      tableId: number;
      tableNumber: number;
      tableLabel: string;
      tableType: string;
      total: number;
      byStatus: Record<string, { count: number; total: number }>;
      days: Map<string, number>;
    }
  >();

  let overallTotal = 0;
  for (const g of games) {
    overallTotal += g.priceFinal;
    overallByStatus[g.paymentStatus] ??= { count: 0, total: 0 };
    overallByStatus[g.paymentStatus]!.count += 1;
    overallByStatus[g.paymentStatus]!.total += g.priceFinal;
    const dayKey = toDateKey(g.startTime);
    overallDays.set(dayKey, (overallDays.get(dayKey) ?? 0) + g.priceFinal);

    if (!perTableMap.has(g.tableId)) {
      perTableMap.set(g.tableId, {
        tableId: g.tableId,
        tableNumber: g.table.tableNumber,
        tableLabel: g.table.label,
        tableType: g.table.tableType,
        total: 0,
        byStatus: {},
        days: new Map(),
      });
    }
    const bucket = perTableMap.get(g.tableId)!;
    bucket.total += g.priceFinal;
    bucket.byStatus[g.paymentStatus] ??= { count: 0, total: 0 };
    bucket.byStatus[g.paymentStatus]!.count += 1;
    bucket.byStatus[g.paymentStatus]!.total += g.priceFinal;
    bucket.days.set(dayKey, (bucket.days.get(dayKey) ?? 0) + g.priceFinal);
  }

  const overall = {
    total: overallTotal,
    byMethod: overallByMethod,
    byStatus: overallByStatus,
    daysInRange,
    dailyAverage: Math.round(overallTotal / daysInRange),
    series: [...overallDays.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total, byMethod: proportionalByMethod(total) })),
  };

  const perTable = [...perTableMap.values()].map((b) => ({
    tableId: b.tableId,
    tableNumber: b.tableNumber,
    tableLabel: b.tableLabel,
    tableType: b.tableType,
    total: b.total,
    byMethod: proportionalByMethod(b.total),
    byStatus: b.byStatus,
    daysInRange,
    dailyAverage: Math.round(b.total / daysInRange),
    series: [...b.days.entries()]
      .sort(([a], [c]) => a.localeCompare(c))
      .map(([date, total]) => ({ date, total, byMethod: proportionalByMethod(total) })),
  }));

  return {
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    overall,
    perTable,
  };
}

export async function getStaffPerformanceReport(
  prisma: PrismaClient,
  opts: { from: Date; to: Date; restrictToUserId?: number }
) {
  const userFilter = opts.restrictToUserId ? { id: opts.restrictToUserId } : {};
  const users = await prisma.user.findMany({ where: userFilter, orderBy: { fullName: "asc" } });

  const results = [];
  for (const user of users) {
    const [gameAgg, discountAgg, paymentAgg, shifts] = await Promise.all([
      prisma.game.aggregate({
        where: {
          createdByUserId: user.id,
          reversed: false,
          startTime: { gte: opts.from, lte: opts.to },
        },
        _sum: { priceFinal: true },
        _count: { _all: true },
      }),
      prisma.game.aggregate({
        where: {
          createdByUserId: user.id,
          reversed: false,
          startTime: { gte: opts.from, lte: opts.to },
        },
        _sum: { discountAmount: true },
      }),
      prisma.payment.aggregate({
        where: { collectedByUserId: user.id, paidAt: { gte: opts.from, lte: opts.to } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.shift.findMany({
        where: { userId: user.id, openedAt: { gte: opts.from, lte: opts.to } },
      }),
    ]);

    const attendanceMinutes = shifts.reduce((sum, s) => {
      const end = s.closedAt ?? new Date();
      return sum + (end.getTime() - s.openedAt.getTime()) / 60000;
    }, 0);

    results.push({
      userId: user.id,
      fullName: user.fullName,
      username: user.username,
      role: user.role,
      gamesCreated: gameAgg._count._all,
      revenueFromGames: gameAgg._sum.priceFinal ?? 0,
      totalDiscountsGiven: discountAgg._sum.discountAmount ?? 0,
      paymentsCollectedCount: paymentAgg._count._all,
      paymentsCollectedAmount: paymentAgg._sum.amount ?? 0,
      shiftsWorked: shifts.length,
      attendanceMinutes,
    });
  }

  return results;
}

export async function getAuditLogReport(
  prisma: PrismaClient,
  opts: { entityType?: string; entityId?: number; performedBy?: number; from?: Date; to?: Date }
) {
  return prisma.auditLog.findMany({
    where: {
      ...(opts.entityType ? { entityType: opts.entityType } : {}),
      ...(opts.entityId !== undefined ? { entityId: opts.entityId } : {}),
      ...(opts.performedBy !== undefined ? { performedById: opts.performedBy } : {}),
      ...(opts.from || opts.to
        ? {
            performedAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: { performedBy: { select: { id: true, fullName: true, username: true } } },
    orderBy: { performedAt: "desc" },
    take: 500,
  });
}

export async function getTrickedReport(prisma: PrismaClient, opts: { from: Date; to: Date }) {
  return prisma.game.findMany({
    where: {
      paymentStatus: "tricked",
      reversed: false,
      startTime: { gte: opts.from, lte: opts.to },
    },
    include: { table: true, gameType: true, loserCustomer: true, createdBy: { select: { id: true, fullName: true } } },
    orderBy: { startTime: "desc" },
  });
}

/**
 * GET /reports/utilization — behavioral requirement #6/design choice: since
 * table_status_log only ever stores 'vacant' windows (occupancy is derived
 * from an open game row), the 'occupied' windows for this report are
 * reconstructed as the complement of the vacant windows within [from, to].
 */
/**
 * table_status_log only ever stores 'vacant' windows (occupancy is derived
 * from an open game row) — this reconstructs the full occupied+vacant
 * timeline for one table within [from, to] by treating every gap between
 * vacant windows as occupied. Shared by getUtilizationReport (which only
 * needs the aggregate minutes/percent) and getTableDayTimelines (which
 * needs the actual segments, e.g. to draw a 24h occupancy chart).
 */
async function reconstructTableWindows(
  prisma: PrismaClient,
  tableId: number,
  from: Date,
  to: Date
): Promise<TableStatusWindow[]> {
  const vacantRows = await prisma.tableStatusLog.findMany({
    where: {
      tableId,
      status: "vacant",
      statusFrom: { lt: to },
      OR: [{ statusTo: null }, { statusTo: { gt: from } }],
    },
    orderBy: { statusFrom: "asc" },
  });

  const clipped = vacantRows.map((r) => ({
    from: r.statusFrom < from ? from : r.statusFrom,
    to: r.statusTo === null || r.statusTo > to ? to : r.statusTo,
  }));

  const windows: TableStatusWindow[] = [];
  let cursor = from;
  for (const w of clipped) {
    if (w.from > cursor) {
      windows.push({ status: "occupied", statusFrom: cursor, statusTo: w.from });
    }
    windows.push({ status: "vacant", statusFrom: w.from, statusTo: w.to });
    cursor = w.to > cursor ? w.to : cursor;
  }
  if (cursor < to) {
    windows.push({ status: "occupied", statusFrom: cursor, statusTo: to });
  }
  return windows;
}

export async function getUtilizationReport(
  prisma: PrismaClient,
  opts: { tableId?: number; from: Date; to: Date }
) {
  const tables = await prisma.table.findMany({
    where: opts.tableId ? { id: opts.tableId } : {},
    orderBy: { tableNumber: "asc" },
  });

  const results = [];
  for (const table of tables) {
    const windows = await reconstructTableWindows(prisma, table.id, opts.from, opts.to);
    const utilization = computeUtilization(windows, opts.to);
    results.push({
      tableId: table.id,
      tableNumber: table.tableNumber,
      label: table.label,
      tableType: table.tableType,
      ...utilization,
    });
  }

  return results;
}

/**
 * The "round graph" data source: every table's full occupied/vacant
 * timeline for exactly one calendar day, clipped to [dayStart, dayEnd) —
 * the shape a 24-hour radial/clock chart draws directly (each segment
 * becomes one colored arc). `date` is interpreted as a local calendar day
 * boundary (00:00–24:00) in the server's timezone.
 */
export async function getTableDayTimelines(prisma: PrismaClient, opts: { date: Date; tableId?: number }) {
  const dayStart = new Date(opts.date.getFullYear(), opts.date.getMonth(), opts.date.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const tables = await prisma.table.findMany({
    where: opts.tableId ? { id: opts.tableId } : {},
    orderBy: { tableNumber: "asc" },
  });

  const results = [];
  for (const table of tables) {
    const windows = await reconstructTableWindows(prisma, table.id, dayStart, dayEnd);
    results.push({
      tableId: table.id,
      tableNumber: table.tableNumber,
      label: table.label,
      date: dayStart.toISOString(),
      segments: windows.map((w) => ({
        status: w.status,
        from: w.statusFrom.toISOString(),
        to: (w.statusTo ?? dayEnd).toISOString(),
      })),
    });
  }

  return results;
}

/** Currently-open games running past double their expected block duration (idle "forgot to end game" alert). */
export async function getIdleAlerts(prisma: PrismaClient) {
  const openGames = await prisma.game.findMany({
    where: { endTime: null, reversed: false },
    include: { table: true, gameType: true, loserCustomer: true },
  });

  const now = new Date();
  return openGames
    .map((g) => {
      const check = checkIdleAlert({
        startTime: g.startTime,
        now,
        blockDurationMinutes: g.gameType.defaultDurationMinutes,
      });
      return {
        gameId: g.id,
        tableId: g.tableId,
        tableNumber: g.table.tableNumber,
        tableLabel: g.table.label,
        gameTypeName: g.gameType.name,
        loserCustomerName: g.loserCustomer?.displayName ?? null,
        startTime: g.startTime.toISOString(),
        ...check,
      };
    })
    .filter((a) => a.isIdleAlert);
}
