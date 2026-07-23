import { useEffect } from "react";
import { useAlertsStore } from "../state/alertsStore";

/**
 * Decision #16 — persistent, visible alert on the Main Dashboard for any
 * table running past double its billed block duration, until acknowledged
 * or the game is ended (ending the game removes it from the underlying
 * poll results automatically, see idleAlertPoller.ts).
 */
export function IdleAlertBanner({ onOpenTable }: { onOpenTable: (tableId: number) => void }) {
  const { init, acknowledge, visibleAlerts } = useAlertsStore();
  const alerts = visibleAlerts();

  useEffect(() => {
    const unsubscribe = init();
    return unsubscribe;
  }, [init]);

  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {alerts.map((a) => (
        <div
          key={a.gameId}
          className="flex items-center justify-between gap-4 rounded-xl border-2 border-amber-400 bg-amber-50 px-5 py-3 text-amber-900 shadow-sm dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <div className="font-bold">
                Table {a.tableNumber} ({a.tableLabel}) has been running for {Math.round(a.minutesElapsed)} min — did someone forget to
                press End Game?
              </div>
              <div className="text-sm opacity-80">
                {a.gameTypeName} · {a.loserName ?? "No name set"} · expected ~{Math.round(a.thresholdMinutes)} min
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button className="btn-secondary py-2 px-4 text-base" onClick={() => onOpenTable(a.tableId)}>
              Open Table
            </button>
            <button className="btn-secondary py-2 px-4 text-base" onClick={() => acknowledge(a.gameId)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
