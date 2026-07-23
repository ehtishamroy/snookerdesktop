export type TableStatusValue = "occupied" | "vacant";

export interface TableStatusWindow {
  status: TableStatusValue;
  statusFrom: Date;
  /** null means still open (current status), caller should pass "now" as the window end for calc purposes. */
  statusTo: Date | null;
}

export interface UtilizationResult {
  occupiedMinutes: number;
  vacantMinutes: number;
  totalMinutes: number;
  utilizationPercent: number;
  vacantWindows: { from: Date; to: Date }[];
}

/**
 * Table Utilization Log (spec §2.7): every vacant window per table, so the
 * owner can cross-check against CCTV to confirm a table was genuinely idle.
 */
export function computeUtilization(windows: TableStatusWindow[], now: Date): UtilizationResult {
  let occupiedMinutes = 0;
  let vacantMinutes = 0;
  const vacantWindows: { from: Date; to: Date }[] = [];

  for (const w of windows) {
    const to = w.statusTo ?? now;
    const minutes = (to.getTime() - w.statusFrom.getTime()) / 60000;
    if (w.status === "occupied") {
      occupiedMinutes += minutes;
    } else {
      vacantMinutes += minutes;
      vacantWindows.push({ from: w.statusFrom, to });
    }
  }

  const totalMinutes = occupiedMinutes + vacantMinutes;
  return {
    occupiedMinutes,
    vacantMinutes,
    totalMinutes,
    utilizationPercent: totalMinutes === 0 ? 0 : (occupiedMinutes / totalMinutes) * 100,
    vacantWindows,
  };
}
