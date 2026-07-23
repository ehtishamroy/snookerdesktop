"use client";

import { useMemo } from "react";
import { StatCard } from "@/components/StatCard";
import { TableTile } from "@/components/TableTile";
import { PaymentMethodBreakdown, PaymentStatusBreakdown } from "@/components/PaymentBreakdownBars";
import { EmptyState } from "@/components/EmptyState";
import { useTables } from "@/hooks/useTables";
import { useRevenueSummary } from "@/hooks/useAnalytics";
import { useLoanLedger } from "@/hooks/useLedger";
import { useShifts } from "@/hooks/useStaffReport";
import { useAuth } from "@/lib/auth";
import { isReceptionistDegraded } from "@/lib/roles";
import { formatDateTime, formatPKR } from "@/lib/format";
import { presetRange } from "@/lib/dateRanges";

export default function DashboardPage() {
  const { user } = useAuth();

  if (isReceptionistDegraded(user?.role)) {
    return <ReceptionistOwnShiftView userId={user!.id} />;
  }

  return <OwnerDashboard />;
}

function OwnerDashboard() {
  const { tables, isLoading: tablesLoading, refresh: refreshTables } = useTables();
  const { today, week, month, isLoading: revenueLoading } = useRevenueSummary();
  const { entries: loanEntries, isLoading: ledgerLoading } = useLoanLedger();

  const occupiedCount = tables.filter((t) => t.status === "occupied").length;
  const vacantCount = tables.filter((t) => t.status === "vacant" && t.isActive).length;
  const totalPendingDues = useMemo(
    () => loanEntries.reduce((sum, e) => sum + e.totalOwed, 0),
    [loanEntries]
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Live status</h1>
        <p className="page-subtitle">Auto-refreshing every few seconds — mirrors the counter dashboard.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Today" value={revenueLoading ? "…" : formatPKR(today?.overall.total ?? 0)} />
        <StatCard label="This week" value={revenueLoading ? "…" : formatPKR(week?.overall.total ?? 0)} />
        <StatCard label="This month" value={revenueLoading ? "…" : formatPKR(month?.overall.total ?? 0)} />
        <StatCard
          label="Pending dues"
          value={ledgerLoading ? "…" : formatPKR(totalPendingDues)}
          tone={totalPendingDues > 0 ? "warning" : "default"}
          hint={`${loanEntries.length} customer${loanEntries.length === 1 ? "" : "s"}`}
        />
        <StatCard label="Occupied" value={tablesLoading ? "…" : String(occupiedCount)} tone="default" />
        <StatCard label="Vacant" value={tablesLoading ? "…" : String(vacantCount)} tone="positive" />
      </section>

      <section>
        <h2 className="section-title mb-3">Tables</h2>
        {tablesLoading && tables.length === 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card h-40 animate-pulse bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : tables.length === 0 ? (
          <EmptyState title="No tables found" hint="Tables are synced from the cloud backend once the desktop app has set them up." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tables.map((table) => (
              <TableTile key={table.id} table={table} onChanged={() => refreshTables()} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="section-title mb-3">Today&apos;s revenue by method</h3>
          {today ? (
            <PaymentMethodBreakdown byMethod={today.overall.byMethod} title="" />
          ) : (
            <div className="text-sm text-slate-400">Loading…</div>
          )}
        </div>
        <div className="card">
          <h3 className="section-title mb-3">Today&apos;s revenue by status</h3>
          {today ? (
            <PaymentStatusBreakdown byStatus={today.overall.byStatus} title="" />
          ) : (
            <div className="text-sm text-slate-400">Loading…</div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Requirement: receptionist accounts must not crash this dashboard even
 * though they aren't meant to use it (spec §6: "Access via mobile app:
 * Receptionist ❌"). They see only their own shift totals — no other staff
 * data, no admin/staff-wide views, no nav links to those pages either (see
 * lib/roles.ts + components/AppShell.tsx).
 */
function ReceptionistOwnShiftView({ userId }: { userId: number }) {
  const today = presetRange("today");
  const { shifts, isLoading } = useShifts({ userId, from: today.from, to: today.to });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Your shifts today</h1>
        <p className="page-subtitle">Only your own totals are shown here.</p>
      </div>
      {isLoading ? (
        <div className="card h-24 animate-pulse bg-slate-100 dark:bg-slate-800" />
      ) : shifts.length === 0 ? (
        <EmptyState title="No shifts today" hint="Open a shift from the counter app to start tracking." />
      ) : (
        <div className="flex flex-col gap-3">
          {shifts.map((s) => (
            <div key={s.id} className="card flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">Shift opened {formatDateTime(s.openedAt)}</div>
                <div className="text-xs text-slate-400">
                  {s.closedAt ? `Closed ${formatDateTime(s.closedAt)}` : "Currently open"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">System cash total</div>
                <div className="text-sm font-semibold">{s.systemCashTotal != null ? formatPKR(s.systemCashTotal) : "—"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
