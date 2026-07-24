import { useEffect, useState } from "react";
import { api } from "../api";
import type { TableVacancyHistoryRow } from "../api";
import { formatDateTime12h } from "../lib/time";

/**
 * "Where can I see when a table was free from X to Y" — every table's
 * vacancy history at once, laid out like the Main Dashboard's table grid.
 * Operational information, not financial, so every role can see this
 * (unlike the owner-only Capital/Analytics page on the web dashboard).
 */
export function VacancyLogScreen() {
  const [rows, setRows] = useState<TableVacancyHistoryRow[] | null>(null);
  const [expandedTableId, setExpandedTableId] = useState<number | null>(null);

  useEffect(() => {
    void api.tables.getAllVacancyHistory().then(setRows);
  }, []);

  if (!rows) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-2xl font-bold">Vacancy Log — Last 30 Days</h1>
      <div className="grid grid-cols-3 gap-5">
        {rows.map((row) => {
          const expanded = expandedTableId === row.tableId;
          return (
            <div key={row.tableId} className="card p-4">
              <button
                className="flex w-full items-center justify-between text-left"
                onClick={() => setExpandedTableId(expanded ? null : row.tableId)}
              >
                <div>
                  <div className="text-lg font-bold">Table {row.tableNumber}</div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">{row.label}</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-extrabold text-blue-700 dark:text-blue-400">{row.utilizationPercent}%</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">occupied</div>
                </div>
              </button>

              {expanded && (
                <div className="mt-4 max-h-64 overflow-y-auto border-t border-slate-200 pt-3 dark:border-slate-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 dark:text-slate-400">
                        <th className="pb-1 pr-2">From</th>
                        <th className="pb-1 pr-2">To</th>
                        <th className="pb-1">Free For</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.windows.map((w, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-700">
                          <td className="py-1 pr-2">{formatDateTime12h(w.from)}</td>
                          <td className="py-1 pr-2">{formatDateTime12h(w.to)}</td>
                          <td className="py-1">
                            {w.durationMinutes >= 60
                              ? `${Math.floor(w.durationMinutes / 60)}h ${w.durationMinutes % 60}m`
                              : `${w.durationMinutes} min`}
                          </td>
                        </tr>
                      ))}
                      {row.windows.length === 0 && (
                        <tr>
                          <td colSpan={3} className="py-3 text-center text-slate-400">
                            No vacancy recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
