"use client";

import { useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { PageGuard } from "@/components/PageGuard";
import { PaymentMethodBreakdown } from "@/components/PaymentBreakdownBars";
import { RangePicker } from "@/components/RangePicker";
import { useStaffPerformance, useShifts } from "@/hooks/useStaffReport";
import { useUsers } from "@/hooks/useUsers";
import type { ShiftEntity, StaffPerformanceEntry } from "@/lib/apiTypes";
import { presetRange, type RangePreset } from "@/lib/dateRanges";
import { exportCsv } from "@/lib/exportCsv";
import { formatDateTime, formatMinutes, formatPKR } from "@/lib/format";
import { CASH_VARIANCE_ATTENTION_THRESHOLD } from "@snooker/shared";

type Tab = "performance" | "attendance";

export default function StaffPage() {
  return (
    <PageGuard allow={["owner", "manager"]}>
      <StaffPageContent />
    </PageGuard>
  );
}

function StaffPageContent() {
  const [tab, setTab] = useState<Tab>("performance");
  const [preset, setPreset] = useState<RangePreset>("month");
  const range = presetRange(preset);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Staff</h1>
          <p className="page-subtitle">Performance totals and shift/attendance records — same underlying shifts data.</p>
        </div>
        <RangePicker value={preset} onChange={setPreset} />
      </div>

      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900 w-fit">
        <TabButton active={tab === "performance"} onClick={() => setTab("performance")}>
          Performance
        </TabButton>
        <TabButton active={tab === "attendance"} onClick={() => setTab("attendance")}>
          Shift &amp; attendance
        </TabButton>
      </div>

      {tab === "performance" ? <PerformanceView from={range.from} to={range.to} /> : <AttendanceView from={range.from} to={range.to} />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function PerformanceView({ from, to }: { from: string; to: string }) {
  const { staff, isLoading } = useStaffPerformance(from, to);
  const sorted = useMemo(() => [...staff].sort((a, b) => b.totalCollected - a.totalCollected), [staff]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button className="btn-secondary text-xs" onClick={() => exportCsv("/reports/staff-performance", { from, to }, "staff-performance.csv")}>
          Export CSV
        </button>
      </div>
      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ) : sorted.length === 0 ? (
        <EmptyState title="No staff activity in this range" />
      ) : (
        <div className="flex flex-col gap-4">
          {sorted.map((s, i) => (
            <StaffPerformanceCard key={s.userId} entry={s} rank={i + 1} />
          ))}
        </div>
      )}
    </section>
  );
}

function StaffPerformanceCard({ entry, rank }: { entry: StaffPerformanceEntry; rank: number }) {
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            #{rank}
          </span>
          <div>
            <div className="text-sm font-semibold">{entry.fullName}</div>
            <div className="text-xs capitalize text-slate-400">
              @{entry.username} · {entry.role}
              {!entry.isActive ? " · inactive" : ""}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">Total collected</div>
          <div className="text-lg font-semibold">{formatPKR(entry.totalCollected)}</div>
        </div>
      </div>
      <PaymentMethodBreakdown byMethod={entry.byMethod} />
      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
        <span>{entry.gamesHandled} games handled</span>
        <span>{formatPKR(entry.discountsGiven)} in discounts given</span>
        <span>{entry.shifts.length} shift{entry.shifts.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}

function AttendanceView({ from, to }: { from: string; to: string }) {
  const { users } = useUsers();
  const { shifts, isLoading } = useShifts({ from, to });

  const rows = useMemo(() => {
    const userById = new Map(users.map((u) => [u.id, u]));
    return shifts
      .map((s) => ({ ...s, user: userById.get(s.userId) }))
      .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
  }, [shifts, users]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button className="btn-secondary text-xs" onClick={() => exportCsv("/shifts", { from, to }, "attendance.csv")}>
          Export CSV
        </button>
      </div>
      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ) : rows.length === 0 ? (
        <EmptyState title="No shifts in this range" />
      ) : (
        <DataTable
          columns={attendanceColumns}
          rows={rows}
          keyField={(r) => r.id}
          defaultSortKey="opened"
        />
      )}
    </section>
  );
}

const attendanceColumns: DataTableColumn<ShiftEntity & { user?: { fullName: string; username: string } }>[] = [
  { key: "staff", header: "Staff", render: (r) => r.user?.fullName ?? `User #${r.userId}` },
  { key: "opened", header: "Clock-in", render: (r) => formatDateTime(r.openedAt), sortValue: (r) => new Date(r.openedAt).getTime() },
  { key: "closed", header: "Clock-out", render: (r) => (r.closedAt ? formatDateTime(r.closedAt) : "Still open") },
  {
    key: "duration",
    header: "Duration",
    render: (r) =>
      r.closedAt ? formatMinutes((new Date(r.closedAt).getTime() - new Date(r.openedAt).getTime()) / 60000) : "—",
    sortable: false,
  },
  {
    key: "variance",
    header: "Cash variance",
    render: (r) => {
      if (r.cashVariance == null) return "—";
      const flagged = Math.abs(r.cashVariance) >= CASH_VARIANCE_ATTENTION_THRESHOLD;
      return (
        <span className={flagged ? "font-semibold text-rose-600 dark:text-rose-400" : ""}>{formatPKR(r.cashVariance)}</span>
      );
    },
    sortValue: (r) => r.cashVariance ?? 0,
    className: "text-right",
  },
];
