"use client";

import { useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { PageGuard } from "@/components/PageGuard";
import { PaymentMethodBadge } from "@/components/PaymentMethodBadge";
import { PaymentMethodBreakdown } from "@/components/PaymentBreakdownBars";
import { RangePicker } from "@/components/RangePicker";
import { StatCard } from "@/components/StatCard";
import { useExpenses } from "@/hooks/useExpenses";
import type { ExpenseEntity } from "@/lib/apiTypes";
import { ZERO_METHOD_TOTALS } from "@/lib/apiTypes";
import { presetRange, type RangePreset } from "@/lib/dateRanges";
import { exportCsv } from "@/lib/exportCsv";
import { formatDateTime, formatPKR, PAYMENT_METHOD_LABELS } from "@/lib/format";
import type { PaymentMethod } from "@snooker/shared";
import { PAYMENT_METHODS } from "@snooker/shared";

export default function ExpensesPage() {
  return (
    <PageGuard allow={["owner", "manager"]}>
      <ExpensesPageContent />
    </PageGuard>
  );
}

function ExpensesPageContent() {
  const [preset, setPreset] = useState<RangePreset>("month");
  const [customFrom, setCustomFrom] = useState<string>();
  const [customTo, setCustomTo] = useState<string>();
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "all">("all");

  const range = useMemo(() => {
    if (preset === "custom" && customFrom && customTo) {
      return { from: new Date(customFrom).toISOString(), to: new Date(customTo + "T23:59:59").toISOString(), label: "Custom" };
    }
    return presetRange(preset);
  }, [preset, customFrom, customTo]);

  const { expenses, isLoading } = useExpenses(range.from, range.to);

  const filtered = useMemo(
    () => (methodFilter === "all" ? expenses : expenses.filter((e) => e.method === methodFilter)),
    [expenses, methodFilter]
  );

  const runningTotal = useMemo(() => filtered.reduce((sum, e) => sum + e.amount, 0), [filtered]);
  const byMethod = useMemo(() => {
    const totals = { ...ZERO_METHOD_TOTALS };
    for (const e of expenses) totals[e.method] += e.amount;
    return totals;
  }, [expenses]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">Money paid out of the drawer — canteen restock, repairs, etc. (decision #11).</p>
        </div>
        <RangePicker value={preset} onChange={setPreset} customFrom={customFrom} customTo={customTo} onCustomChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }} />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Running total" value={formatPKR(runningTotal)} />
        <StatCard label="Entries" value={String(filtered.length)} />
        <StatCard label="Range" value={range.label} />
      </section>

      <section className="card">
        <PaymentMethodBreakdown byMethod={byMethod} title="Total expenses by method" />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Method</span>
            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as PaymentMethod | "all")} className="input !w-auto py-1.5 text-xs">
              <option value="all">All methods</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn-secondary text-xs"
            onClick={() => exportCsv("/expenses", { from: range.from, to: range.to }, "expenses.csv")}
          >
            Export CSV
          </button>
        </div>

        {isLoading ? (
          <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No expenses in this range" />
        ) : (
          <DataTable
            columns={expenseColumns}
            rows={filtered}
            keyField={(r) => r.id}
            defaultSortKey="date"
            rowClassName={(r) => (r.edited ? "bg-amber-50/60 dark:bg-amber-900/10" : "")}
          />
        )}
      </section>
    </div>
  );
}

const expenseColumns: DataTableColumn<ExpenseEntity>[] = [
  { key: "date", header: "Date", render: (r) => formatDateTime(r.spentAt), sortValue: (r) => new Date(r.spentAt).getTime() },
  {
    key: "category",
    header: "Category",
    render: (r) => (
      <div className="flex items-center gap-2">
        <span>{r.category}</span>
        {r.edited ? (
          <span
            title={r.editedAt ? `Edited ${formatDateTime(r.editedAt)}` : "Edited"}
            className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          >
            Edited
          </span>
        ) : null}
      </div>
    ),
  },
  { key: "method", header: "Method", render: (r) => <PaymentMethodBadge method={r.method} />, sortable: false },
  { key: "note", header: "Note", render: (r) => r.note ?? "—", sortable: false },
  { key: "amount", header: "Amount", render: (r) => formatPKR(r.amount), sortValue: (r) => r.amount, className: "text-right font-semibold" },
];
