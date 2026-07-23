import { startOfDay } from "date-fns";
import { buildZReport } from "@snooker/shared";
import { getDb } from "../client";
import { countOpenCollateral } from "./collateralRepo";
import { previewZReport } from "./shiftsRepo";
import { getCurrentSession } from "../session";
import type { LocalReportsSummary, PerTableRevenueRow } from "../../../ipc/contract";

/** ReportsScreen's local subset (spec §5.4, scoped to what's meaningful offline on a single counter). */
export function getLocalSummary(): LocalReportsSummary {
  const db = getDb();
  const todayStart = startOfDay(new Date()).toISOString();

  const perTableRows = db
    .prepare(
      `SELECT t.id AS table_id, t.table_number, t.label,
              COALESCE(SUM(g.price_final), 0) AS revenue_today,
              COALESCE(SUM(CASE WHEN g.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS rounds_today
       FROM tables t
       LEFT JOIN games g ON g.table_id = t.id AND g.reversed = 0 AND g.end_time IS NOT NULL AND g.start_time >= ?
       GROUP BY t.id
       ORDER BY t.table_number ASC`
    )
    .all(todayStart) as any[];

  const perTableRevenue: PerTableRevenueRow[] = perTableRows.map((r) => ({
    tableId: r.table_id,
    tableNumber: r.table_number,
    label: r.label,
    revenueToday: r.revenue_today,
    roundsToday: r.rounds_today,
  }));

  const totalRevenueToday = perTableRevenue.reduce((sum, r) => sum + r.revenueToday, 0);

  const pendingRow = db
    .prepare(
      `SELECT COALESCE(SUM(price_final), 0) AS total FROM games
       WHERE reversed = 0 AND end_time IS NOT NULL AND payment_status IN ('pending','collateral','tricked')`
    )
    .get() as { total: number };
  const loanRow = db
    .prepare(
      `SELECT COALESCE(SUM(price_final), 0) AS total FROM games
       WHERE reversed = 0 AND end_time IS NOT NULL AND payment_status = 'loan'`
    )
    .get() as { total: number };
  const discountsRow = db
    .prepare(
      `SELECT COALESCE(SUM(discount_amount), 0) AS total FROM games
       WHERE reversed = 0 AND end_time IS NOT NULL AND start_time >= ?`
    )
    .get(todayStart) as { total: number };
  const trickedRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM games
       WHERE reversed = 0 AND end_time IS NOT NULL AND payment_status = 'tricked' AND start_time >= ?`
    )
    .get(todayStart) as { c: number };

  const session = getCurrentSession();
  const currentShiftZReportPreview = session
    ? previewZReport(session.shift.id)
    : buildZReport({ payments: [], expenses: [], games: [], declaredCashAmount: 0 });

  return {
    date: todayStart,
    totalRevenueToday,
    pendingDuesTotal: pendingRow.total,
    loanTotal: loanRow.total,
    discountsGivenToday: discountsRow.total,
    trickedCountToday: trickedRow.c,
    collateralOpenCount: countOpenCollateral(),
    perTableRevenue,
    currentShiftZReportPreview,
  };
}
