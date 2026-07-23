import type { PrismaClient } from "@prisma/client";
import { checkIdleAlert, computeUtilization, type TableStatusWindow } from "@snooker/shared";

export interface DateRange {
  from: Date;
  to: Date;
}

export function resolveDateRange(from?: string, to?: string): DateRange {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: fromDate, to: toDate };
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
    select: { tableId: true, paymentStatus: true, priceFinal: true, discountAmount: true, table: { select: { tableNumber: true, label: true } } },
  });

  const byTableMap = new Map<number, { tableId: number; tableNumber: number; label: string; byStatus: Record<string, { count: number; total: number }> }>();
  const byStatusOverall: Record<string, { count: number; total: number }> = {};

  for (const g of games) {
    if (!byTableMap.has(g.tableId)) {
      byTableMap.set(g.tableId, {
        tableId: g.tableId,
        tableNumber: g.table.tableNumber,
        label: g.table.label,
        byStatus: {},
      });
    }
    const tableBucket = byTableMap.get(g.tableId)!;
    tableBucket.byStatus[g.paymentStatus] ??= { count: 0, total: 0 };
    tableBucket.byStatus[g.paymentStatus]!.count += 1;
    tableBucket.byStatus[g.paymentStatus]!.total += g.priceFinal;

    byStatusOverall[g.paymentStatus] ??= { count: 0, total: 0 };
    byStatusOverall[g.paymentStatus]!.count += 1;
    byStatusOverall[g.paymentStatus]!.total += g.priceFinal;
  }

  const payments = await prisma.payment.findMany({
    where: { paidAt: { gte: opts.from, lte: opts.to } },
    select: { method: true, amount: true },
  });
  const byPaymentMethod: Record<string, number> = {};
  for (const p of payments) {
    byPaymentMethod[p.method] = (byPaymentMethod[p.method] ?? 0) + p.amount;
  }

  const totalBilled = games.reduce((sum, g) => sum + g.priceFinal, 0);
  const totalDiscounts = games.reduce((sum, g) => sum + g.discountAmount, 0);
  const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);

  return {
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    byTable: [...byTableMap.values()],
    byPaymentStatus: byStatusOverall,
    byPaymentMethod,
    totalBilled,
    totalDiscounts,
    totalCollected,
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
    const vacantRows = await prisma.tableStatusLog.findMany({
      where: {
        tableId: table.id,
        status: "vacant",
        statusFrom: { lt: opts.to },
        OR: [{ statusTo: null }, { statusTo: { gt: opts.from } }],
      },
      orderBy: { statusFrom: "asc" },
    });

    const clipped = vacantRows.map((r) => ({
      from: r.statusFrom < opts.from ? opts.from : r.statusFrom,
      to: r.statusTo === null || r.statusTo > opts.to ? opts.to : r.statusTo,
    }));

    const windows: TableStatusWindow[] = [];
    let cursor = opts.from;
    for (const w of clipped) {
      if (w.from > cursor) {
        windows.push({ status: "occupied", statusFrom: cursor, statusTo: w.from });
      }
      windows.push({ status: "vacant", statusFrom: w.from, statusTo: w.to });
      cursor = w.to > cursor ? w.to : cursor;
    }
    if (cursor < opts.to) {
      windows.push({ status: "occupied", statusFrom: cursor, statusTo: opts.to });
    }

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
