import { useEffect, useState } from "react";
import { api } from "../api";
import type { LocalReportsSummary } from "../api";
import { useAuthStore } from "../state/authStore";

/** Local subset of Reports & Analytics (spec §5.4) — full cross-branch/date-range analytics live on the Owner Dashboard. */
export function ReportsScreen() {
  const [summary, setSummary] = useState<LocalReportsSummary | null>(null);

  useEffect(() => {
    void api.reports.getLocalSummary().then(setSummary);
    const interval = setInterval(() => void api.reports.getLocalSummary().then(setSummary), 15000);
    return () => clearInterval(interval);
  }, []);

  if (!summary) return <div className="text-slate-400">Loading…</div>;

  const z = summary.currentShiftZReportPreview;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Total Revenue Today" value={`Rs. ${summary.totalRevenueToday}`} />
        <Stat label="Pending / Collateral / Tricked" value={`Rs. ${summary.pendingDuesTotal}`} />
        <Stat label="Loan (Udhaar) Outstanding" value={`Rs. ${summary.loanTotal}`} />
        <Stat label="Discounts Given Today" value={`Rs. ${summary.discountsGivenToday}`} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-lg font-bold">Per-Table Revenue — Today</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left dark:bg-slate-700">
            <tr>
              <th className="px-3 py-2">Table</th>
              <th className="px-3 py-2 text-right">Rounds</th>
              <th className="px-3 py-2 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {summary.perTableRevenue.map((row) => (
              <tr key={row.tableId} className="border-t border-slate-200 dark:border-slate-700">
                <td className="px-3 py-2">{row.label}</td>
                <td className="px-3 py-2 text-right">{row.roundsToday}</td>
                <td className="px-3 py-2 text-right font-semibold">Rs. {row.revenueToday}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold">Current Shift — Z-Report Preview</h2>
          <button
            className="btn-danger py-2 px-4 text-base"
            onClick={() => useAuthStore.getState().openPendingShiftClose("close-shift")}
          >
            Close Shift
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Closing your shift always logs you out immediately afterward (decision #5).
        </p>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <Stat label="Cash" value={`Rs. ${z.totalsByMethod.cash}`} small />
          <Stat label="EasyPaisa" value={`Rs. ${z.totalsByMethod.easypaisa}`} small />
          <Stat label="JazzCash" value={`Rs. ${z.totalsByMethod.jazzcash}`} small />
          <Stat label="Card" value={`Rs. ${z.totalsByMethod.card}`} small />
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Net after today&rsquo;s expenses (expenses always come out of the club&rsquo;s own earnings):
        </p>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <Stat label="Net Cash" value={`Rs. ${z.netByMethod.cash}`} small />
          <Stat label="Net EasyPaisa" value={`Rs. ${z.netByMethod.easypaisa}`} small />
          <Stat label="Net JazzCash" value={`Rs. ${z.netByMethod.jazzcash}`} small />
          <Stat label="Net Card" value={`Rs. ${z.netByMethod.card}`} small />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-4 text-sm">
          <Stat label="Total Collected" value={`Rs. ${z.totalCollected}`} small />
          <Stat label="Discounts Given" value={`Rs. ${z.totalDiscountsGiven}`} small />
          <Stat label="Pending Created" value={`Rs. ${z.totalPendingCreated}`} small />
          <Stat label="Loan Created" value={`Rs. ${z.totalLoanCreated}`} small />
        </div>
        <div className="mt-4 flex gap-6 text-sm">
          <span>
            Tricked / walked out: <strong>{z.totalTrickedCount}</strong>
          </span>
          <span>
            Collateral held (open): <strong>{summary.collateralOpenCount}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className={small ? "" : "card p-4"}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={small ? "text-lg font-bold" : "text-2xl font-extrabold"}>{value}</div>
    </div>
  );
}
