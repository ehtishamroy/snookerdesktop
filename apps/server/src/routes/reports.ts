import { Router, type Request } from "express";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { sendCsv } from "../lib/csv";
import {
  getAuditLogReport,
  getIdleAlerts,
  getRevenueReport,
  getStaffPerformanceReport,
  getTrickedReport,
  getUtilizationReport,
  resolveDateRange,
} from "../services/reportService";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

function wantsCsv(req: Request): boolean {
  return req.query.format === "csv";
}

/**
 * GET /reports/revenue — owner/manager only (financial oversight report).
 * A receptionist has no scoped variant of this one since revenue isn't
 * meaningfully attributable to a single staff member's "own totals" the way
 * staff-performance/shifts are.
 */
reportsRouter.get(
  "/revenue",
  requireRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveDateRange(req.query.from as string | undefined, req.query.to as string | undefined);
    const tableId = req.query.tableId ? Number(req.query.tableId) : undefined;
    const report = await getRevenueReport(prisma, { tableId, from, to });

    if (wantsCsv(req)) {
      const rows = report.perTable.map((t) => ({
        tableId: t.tableId,
        tableNumber: t.tableNumber,
        label: t.tableLabel,
        total: t.total,
        dailyAverage: t.dailyAverage,
        ...Object.fromEntries(
          Object.entries(t.byStatus).flatMap(([status, agg]) => [
            [`${status}_count`, agg.count],
            [`${status}_total`, agg.total],
          ])
        ),
      }));
      return sendCsv(res, "revenue.csv", rows);
    }
    res.json(report);
  })
);

/**
 * GET /reports/staff-performance — behavioral requirement #2: a
 * receptionist is force-scoped to their own totals only; owner/manager can
 * see everyone (optionally still filtered further, but no restriction).
 */
reportsRouter.get(
  "/staff-performance",
  asyncHandler(async (req, res) => {
    const { from, to } = resolveDateRange(req.query.from as string | undefined, req.query.to as string | undefined);
    const restrictToUserId = req.user!.role === "receptionist" ? req.user!.userId : undefined;
    const report = await getStaffPerformanceReport(prisma, { from, to, restrictToUserId });

    if (wantsCsv(req)) return sendCsv(res, "staff-performance.csv", report as unknown as Record<string, unknown>[]);
    res.json(report);
  })
);

reportsRouter.get(
  "/audit-log",
  requireRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId ? Number(req.query.entityId) : undefined;
    const performedBy = req.query.performedBy ? Number(req.query.performedBy) : undefined;
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;

    const rows = await getAuditLogReport(prisma, { entityType, entityId, performedBy, from, to });

    if (wantsCsv(req)) {
      const flat = rows.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        action: r.action,
        performedBy: r.performedBy.fullName,
        performedAt: r.performedAt,
        beforeValue: JSON.stringify(r.beforeValue),
        afterValue: JSON.stringify(r.afterValue),
      }));
      return sendCsv(res, "audit-log.csv", flat);
    }
    res.json(rows);
  })
);

reportsRouter.get(
  "/tricked",
  requireRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveDateRange(req.query.from as string | undefined, req.query.to as string | undefined);
    const rows = await getTrickedReport(prisma, { from, to });

    if (wantsCsv(req)) {
      const flat = rows.map((r) => ({
        gameId: r.id,
        table: r.table.label,
        gameType: r.gameType.name,
        loserCustomer: r.loserCustomer?.displayName ?? "",
        startTime: r.startTime,
        endTime: r.endTime,
        priceFinal: r.priceFinal,
        createdBy: r.createdBy.fullName,
      }));
      return sendCsv(res, "tricked.csv", flat);
    }
    res.json(rows);
  })
);

reportsRouter.get(
  "/utilization",
  requireRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveDateRange(req.query.from as string | undefined, req.query.to as string | undefined);
    const tableId = req.query.tableId ? Number(req.query.tableId) : undefined;
    const rows = await getUtilizationReport(prisma, { tableId, from, to });

    if (wantsCsv(req)) {
      const flat = rows.map((r) => ({
        tableId: r.tableId,
        tableNumber: r.tableNumber,
        label: r.label,
        tableType: r.tableType,
        occupiedMinutes: r.occupiedMinutes,
        vacantMinutes: r.vacantMinutes,
        utilizationPercent: r.utilizationPercent.toFixed(2),
      }));
      return sendCsv(res, "utilization.csv", flat);
    }
    res.json(rows);
  })
);

/**
 * GET /reports/idle-alerts — see src/jobs/idleAlertScan.ts for the
 * documented design choice: this always recomputes on demand rather than
 * only reading the periodic job's cache, so it's never more than one query
 * stale.
 */
reportsRouter.get(
  "/idle-alerts",
  asyncHandler(async (_req, res) => {
    const alerts = await getIdleAlerts(prisma);
    res.json(alerts);
  })
);
