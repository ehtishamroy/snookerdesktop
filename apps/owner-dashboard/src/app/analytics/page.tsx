"use client";

import { useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { PageGuard } from "@/components/PageGuard";
import { PaymentMethodBreakdown, PaymentStatusBreakdown } from "@/components/PaymentBreakdownBars";
import { RangePicker } from "@/components/RangePicker";
import { RevenueChart } from "@/components/RevenueChart";
import { StatCard } from "@/components/StatCard";
import { useRevenueReport, useTableDayTimelines, useUtilizationReport } from "@/hooks/useAnalytics";
import { useLoanLedger } from "@/hooks/useLedger";
import { useStaffPerformance } from "@/hooks/useStaffReport";
import { useTables } from "@/hooks/useTables";
import { DayClockLegend, TableDayClock } from "@/components/TableDayClock";
import type { TableRevenueBreakdown, TableUtilizationWire } from "@/lib/apiTypes";
import { presetRange, type RangePreset } from "@/lib/dateRanges";
import { exportCsv } from "@/lib/exportCsv";
import { formatDate, formatMinutes, formatPercent, formatPKR } from "@/lib/format";
import type { LoanLedgerEntry } from "@/lib/apiTypes";

function todayDateInputValue(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function AnalyticsPage() {
  return (
    <PageGuard allow={["owner", "manager"]}>
      <AnalyticsPageContent />
    </PageGuard>
  );
}

function AnalyticsPageContent() {
  const [preset, setPreset] = useState<RangePreset>("month");
  const [customFrom, setCustomFrom] = useState<string | undefined>();
  const [customTo, setCustomTo] = useState<string | undefined>();
  const [selectedTableId, setSelectedTableId] = useState<number | "all">("all");

  const range = useMemo(() => {
    if (preset === "custom" && customFrom && customTo) {
      return { from: new Date(customFrom).toISOString(), to: new Date(customTo + "T23:59:59").toISOString(), label: "Custom" };
    }
    return presetRange(preset);
  }, [preset, customFrom, customTo]);

  const { tables } = useTables();
  const { report, isLoading: revenueLoading } = useRevenueReport(
    range.from,
    range.to,
    selectedTableId === "all" ? undefined : selectedTableId
  );
  const { utilization, isLoading: utilLoading } = useUtilizationReport(range.from, range.to);
  const [selectedDay, setSelectedDay] = useState(todayDateInputValue);
  const { timelines, isLoading: timelinesLoading } = useTableDayTimelines(selectedDay);
  const { entries: loanEntries } = useLoanLedger();
  const { staff, isLoading: staffLoading } = useStaffPerformance(range.from, range.to);

  const topByAmount = useMemo(() => [...loanEntries].sort((a, b) => b.totalOwed - a.totalOwed).slice(0, 10), [loanEntries]);
  const topByFrequency = useMemo(
    () => [...loanEntries].sort((a, b) => b.unsettledCount - a.unsettledCount).slice(0, 10),
    [loanEntries]
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Revenue, utilization, ledger and staff performance for {range.label.toLowerCase()}.</p>
        </div>
        <RangePicker
          value={preset}
          onChange={setPreset}
          customFrom={customFrom}
          customTo={customTo}
          onCustomChange={(f, t) => {
            setCustomFrom(f);
            setCustomTo(t);
          }}
        />
      </div>

      {/* Overall revenue */}
      <section className="card flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Overall revenue</h2>
          <div className="flex items-center gap-2">
            <select
              value={selectedTableId}
              onChange={(e) => setSelectedTableId(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="input !w-auto py-1.5 text-xs"
            >
              <option value="all">All tables</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary text-xs"
              onClick={() => exportCsv("/reports/revenue", { from: range.from, to: range.to, tableId: selectedTableId === "all" ? undefined : selectedTableId }, "revenue.csv")}
            >
              Export CSV
            </button>
          </div>
        </div>

        {revenueLoading || !report ? (
          <div className="h-64 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Total" value={formatPKR(report.overall.total)} />
              <StatCard label="Daily average" value={formatPKR(report.overall.dailyAverage)} />
              <StatCard label="Days in range" value={String(report.overall.daysInRange)} />
              <StatCard label="Tables included" value={String(report.perTable.length)} />
            </div>
            <RevenueChart series={report.overall.series} />
            <div className="grid gap-4 sm:grid-cols-2">
              <PaymentMethodBreakdown byMethod={report.overall.byMethod} />
              <PaymentStatusBreakdown byStatus={report.overall.byStatus} />
            </div>
          </>
        )}
      </section>

      {/* Per-table revenue */}
      <section className="flex flex-col gap-3">
        <h2 className="section-title">Per-table revenue</h2>
        {revenueLoading || !report ? (
          <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : report.perTable.length === 0 ? (
          <EmptyState title="No table revenue in this range" />
        ) : (
          <DataTable
            columns={perTableColumns}
            rows={report.perTable}
            keyField={(r) => r.tableId}
            defaultSortKey="total"
          />
        )}
      </section>

      {/* Table occupancy — day view (the "round graph") */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="section-title">Table occupancy — day view</h2>
            <p className="text-xs text-slate-400">
              One 24-hour ring per table — occupied vs vacant, at a glance. Hover a segment for its exact time.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="btn-secondary px-2 py-1 text-xs"
              onClick={() => {
                const d = new Date(selectedDay);
                d.setDate(d.getDate() - 1);
                setSelectedDay(d.toISOString().slice(0, 10));
              }}
              aria-label="Previous day"
            >
              ←
            </button>
            <input
              type="date"
              className="input !w-auto py-1 text-xs"
              value={selectedDay}
              max={todayDateInputValue()}
              onChange={(e) => setSelectedDay(e.target.value)}
            />
            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setSelectedDay(todayDateInputValue())}>
              Today
            </button>
            <button
              className="btn-secondary px-2 py-1 text-xs"
              disabled={selectedDay >= todayDateInputValue()}
              onClick={() => {
                const d = new Date(selectedDay);
                d.setDate(d.getDate() + 1);
                setSelectedDay(d.toISOString().slice(0, 10));
              }}
              aria-label="Next day"
            >
              →
            </button>
          </div>
        </div>
        <DayClockLegend />
        {timelinesLoading ? (
          <div className="h-56 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : timelines.length === 0 ? (
          <EmptyState title="No data for this day" />
        ) : (
          <div className="card grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {timelines.map((t) => {
              const occupiedMs = t.segments
                .filter((s) => s.status === "occupied")
                .reduce((sum, s) => sum + (new Date(s.to).getTime() - new Date(s.from).getTime()), 0);
              const totalMs = new Date(t.segments[t.segments.length - 1]?.to ?? t.date).getTime() - new Date(t.date).getTime();
              const pct = totalMs > 0 ? Math.round((occupiedMs / totalMs) * 100) : 0;
              return (
                <TableDayClock
                  key={t.tableId}
                  dayStartIso={t.date}
                  segments={t.segments}
                  label={t.label}
                  utilizationPercent={pct}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* Utilization */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Table utilization (busy vs vacant)</h2>
          <button
            className="btn-secondary text-xs"
            onClick={() => exportCsv("/reports/utilization", { from: range.from, to: range.to }, "utilization.csv")}
          >
            Export CSV
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Vacant windows are logged per table so you can cross-check against CCTV footage for genuinely idle periods
          (spec §2.7).
        </p>
        {utilLoading ? (
          <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : utilization.length === 0 ? (
          <EmptyState title="No utilization data in this range" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {utilization.map((u) => (
              <UtilizationCard key={u.tableId} data={u} />
            ))}
          </div>
        )}
      </section>

      {/* Top customers */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="section-title">Top customers by amount owed</h2>
          <DataTable
            columns={topCustomerAmountColumns}
            rows={topByAmount}
            keyField={(r) => r.customerId}
            emptyMessage="No outstanding balances."
          />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="section-title">Top customers by rounds owed (frequency)</h2>
          <p className="text-xs text-slate-400 -mt-1">
            Counts unsettled rounds currently on the ledger — a proxy for frequency until a dedicated lifetime
            visit-count report exists server-side.
          </p>
          <DataTable
            columns={topCustomerFrequencyColumns}
            rows={topByFrequency}
            keyField={(r) => r.customerId}
            emptyMessage="No outstanding balances."
          />
        </div>
      </section>

      {/* Staff performance */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Per-staff collected totals</h2>
          <button
            className="btn-secondary text-xs"
            onClick={() => exportCsv("/reports/staff-performance", { from: range.from, to: range.to }, "staff-performance.csv")}
          >
            Export CSV
          </button>
        </div>
        {staffLoading ? (
          <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : staff.length === 0 ? (
          <EmptyState title="No staff activity in this range" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((s) => (
              <div key={s.userId} className="card flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{s.fullName}</div>
                    <div className="text-xs capitalize text-slate-400">{s.role}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Collected</div>
                    <div className="text-sm font-semibold">{formatPKR(s.totalCollected)}</div>
                  </div>
                </div>
                <PaymentMethodBreakdown byMethod={s.byMethod} title="" />
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{s.gamesHandled} games</span>
                  <span>{formatPKR(s.discountsGiven)} discounted</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const perTableColumns: DataTableColumn<TableRevenueBreakdown>[] = [
  { key: "tableLabel", header: "Table", render: (r) => r.tableLabel },
  { key: "total", header: "Total", render: (r) => formatPKR(r.total), sortValue: (r) => r.total, className: "text-right" },
  {
    key: "dailyAverage",
    header: "Daily avg",
    render: (r) => formatPKR(r.dailyAverage),
    sortValue: (r) => r.dailyAverage,
    className: "text-right",
  },
  {
    key: "cash",
    header: "Cash",
    render: (r) => formatPKR(r.byMethod.cash),
    sortValue: (r) => r.byMethod.cash,
    className: "text-right",
  },
  {
    key: "easypaisa",
    header: "EasyPaisa",
    render: (r) => formatPKR(r.byMethod.easypaisa),
    sortValue: (r) => r.byMethod.easypaisa,
    className: "text-right",
  },
  {
    key: "jazzcash",
    header: "JazzCash",
    render: (r) => formatPKR(r.byMethod.jazzcash),
    sortValue: (r) => r.byMethod.jazzcash,
    className: "text-right",
  },
  {
    key: "card",
    header: "Card",
    render: (r) => formatPKR(r.byMethod.card),
    sortValue: (r) => r.byMethod.card,
    className: "text-right",
  },
];

const topCustomerAmountColumns: DataTableColumn<LoanLedgerEntry>[] = [
  {
    key: "name",
    header: "Customer",
    render: (r) => (r.isTemporary ? `${r.displayName} (nishani)` : r.displayName),
  },
  { key: "owed", header: "Owed", render: (r) => formatPKR(r.totalOwed), sortValue: (r) => r.totalOwed, className: "text-right" },
  { key: "rounds", header: "Rounds", render: (r) => r.unsettledCount, sortValue: (r) => r.unsettledCount, className: "text-right" },
];

const topCustomerFrequencyColumns: DataTableColumn<LoanLedgerEntry>[] = [
  {
    key: "name",
    header: "Customer",
    render: (r) => (r.isTemporary ? `${r.displayName} (nishani)` : r.displayName),
  },
  { key: "rounds", header: "Rounds owed", render: (r) => r.unsettledCount, sortValue: (r) => r.unsettledCount, className: "text-right" },
  { key: "owed", header: "Amount", render: (r) => formatPKR(r.totalOwed), sortValue: (r) => r.totalOwed, className: "text-right" },
];

function UtilizationCard({ data }: { data: TableUtilizationWire }) {
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{data.tableLabel}</span>
        <span className="text-sm font-semibold text-brand-600 dark:text-brand-400">
          {formatPercent(data.utilizationPercent)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full bg-brand-500" style={{ width: `${data.utilizationPercent}%` }} />
      </div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>Busy {formatMinutes(data.occupiedMinutes)}</span>
        <span>Vacant {formatMinutes(data.vacantMinutes)}</span>
      </div>
      {data.vacantWindows.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500 dark:text-slate-400">
            {data.vacantWindows.length} vacant window{data.vacantWindows.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 flex flex-col gap-1 text-slate-500 dark:text-slate-400">
            {data.vacantWindows.slice(0, 20).map((w, i) => (
              <li key={i}>
                {formatDate(w.from)} · {new Date(w.from).toLocaleTimeString()} → {new Date(w.to).toLocaleTimeString()}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
