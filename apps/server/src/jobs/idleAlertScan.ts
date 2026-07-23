import type { PrismaClient } from "@prisma/client";
import { getIdleAlerts } from "../services/reportService";

export interface IdleAlert {
  gameId: number;
  tableId: number;
  tableNumber: number;
  tableLabel: string;
  gameTypeName: string;
  loserCustomerName: string | null;
  startTime: string;
  isIdleAlert: boolean;
  minutesElapsed: number;
  thresholdMinutes: number;
}

/**
 * Design choice (documented per the task's instructions, since either
 * approach was acceptable): `GET /reports/idle-alerts` computes on demand,
 * straight from the DB (see reportService.getIdleAlerts) — the query is
 * cheap (there are only ever a handful of open games at once) and this
 * guarantees the response is always fresh rather than up-to-a-minute stale.
 *
 * This module's `scanIdleAlerts` is the periodic node-cron job described in
 * API_CONTRACT.md's "Background jobs" section. It additionally refreshes an
 * in-memory cache (`getCachedIdleAlerts`) for any future push-style
 * consumer (e.g. a websocket broadcast to the owner dashboard) and logs
 * newly-crossed-threshold alerts server-side, without requiring every
 * consumer to hit the DB directly.
 */
let cachedAlerts: IdleAlert[] = [];
let previouslyAlertedGameIds = new Set<number>();

export function getCachedIdleAlerts(): IdleAlert[] {
  return cachedAlerts;
}

export async function scanIdleAlerts(prisma: PrismaClient): Promise<IdleAlert[]> {
  const alerts = await getIdleAlerts(prisma);
  cachedAlerts = alerts;

  const currentIds = new Set(alerts.map((a) => a.gameId));
  const newlyAlerted = alerts.filter((a) => !previouslyAlertedGameIds.has(a.gameId));
  for (const alert of newlyAlerted) {
    // eslint-disable-next-line no-console
    console.warn(
      `[idle-alert] Table ${alert.tableNumber} (${alert.tableLabel}) — game ${alert.gameId} (${alert.gameTypeName}) ` +
        `has run ${alert.minutesElapsed.toFixed(1)}m, past its ${alert.thresholdMinutes}m idle threshold.`
    );
  }
  previouslyAlertedGameIds = currentIds;

  return alerts;
}
