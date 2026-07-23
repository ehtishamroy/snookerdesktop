import type { Db } from "../lib/audit";

/**
 * Behavioral requirement #6: table_status_log must capture the full
 * vacant-window history for the utilization report (§2.7). Design choice
 * (documented per the task's "pick whichever approach is simplest"):
 * current occupancy is *derived* — a table is occupied iff it has a Game
 * row with `endTime IS NULL` (see tables route) — so we never need to write
 * an explicit 'occupied' row. table_status_log only ever stores 'vacant'
 * windows: closing one when a game starts, opening a new one when a game
 * ends.
 */

/** Called when a game starts on a table: closes any currently-open vacant window as of `startTime`. */
export async function closeVacantWindow(db: Db, tableId: number, startTime: Date): Promise<void> {
  const open = await db.tableStatusLog.findFirst({
    where: { tableId, status: "vacant", statusTo: null },
    orderBy: { statusFrom: "desc" },
  });
  if (!open) {
    // No open vacant window to close (e.g. a race, or a table whose history
    // predates seeding). Nothing to do — occupancy is derived from the game
    // row regardless, so this only affects the granularity of the
    // utilization report's vacancy history, not correctness of "is this
    // table occupied right now".
    return;
  }
  await db.tableStatusLog.update({
    where: { id: open.id },
    data: { statusTo: startTime },
  });
}

/** Called when a game ends on a table: opens a new vacant window starting at `endTime`. */
export async function openVacantWindow(db: Db, tableId: number, endTime: Date): Promise<void> {
  const alreadyOpen = await db.tableStatusLog.findFirst({
    where: { tableId, status: "vacant", statusTo: null },
  });
  if (alreadyOpen) return; // defensive: don't open a second concurrent open window

  await db.tableStatusLog.create({
    data: { tableId, status: "vacant", statusFrom: endTime, statusTo: null },
  });
}
