"use client";

import { useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { PageGuard } from "@/components/PageGuard";
import { PaymentStatusBadge } from "@/components/PaymentStatusBadge";
import { RangePicker } from "@/components/RangePicker";
import { StatCard } from "@/components/StatCard";
import { useCustomerLedger, useLoanLedger, useTrickedLog } from "@/hooks/useLedger";
import type { LoanLedgerEntry, TrickedEntry } from "@/lib/apiTypes";
import { presetRange, type RangePreset } from "@/lib/dateRanges";
import { exportCsv } from "@/lib/exportCsv";
import { formatDateTime, formatPKR } from "@/lib/format";

export default function LedgerPage() {
  return (
    <PageGuard allow={["owner", "manager"]}>
      <LedgerPageContent />
    </PageGuard>
  );
}

function LedgerPageContent() {
  const { entries, isLoading } = useLoanLedger();
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [preset, setPreset] = useState<RangePreset>("month");
  const range = presetRange(preset);
  const { entries: tricked, isLoading: trickedLoading } = useTrickedLog(range.from, range.to);

  const totalOwed = useMemo(() => entries.reduce((sum, e) => sum + e.totalOwed, 0), [entries]);
  const { ledger } = useCustomerLedger(selectedCustomerId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title">Loan / Pending ledger</h1>
        <p className="page-subtitle">Every customer with an outstanding balance, sortable by amount.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total outstanding" value={formatPKR(totalOwed)} tone={totalOwed > 0 ? "warning" : "default"} />
        <StatCard label="Customers with dues" value={String(entries.length)} />
        <StatCard label="Tricked entries (this month)" value={String(tricked.length)} tone={tricked.length > 0 ? "danger" : "default"} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Outstanding balances</h2>
          <button className="btn-secondary text-xs" onClick={() => exportCsv("/customers/loan-ledger", {}, "loan-ledger.csv")}>
            Export CSV
          </button>
        </div>
        <DataTable
          columns={ledgerColumns(setSelectedCustomerId)}
          rows={entries}
          keyField={(r) => r.customerId}
          isLoading={isLoading}
          defaultSortKey="owed"
          emptyMessage="No outstanding balances — everyone is settled up."
        />
      </section>

      {selectedCustomerId && ledger ? (
        <section className="card flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title">
              {ledger.customerName}
              {ledger.isTemporary ? " (nishani — temporary)" : ""}
            </h2>
            <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setSelectedCustomerId(null)}>
              Close
            </button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-500 dark:text-slate-400">
            <span>Span: {formatDateTime(ledger.spanStart)} → {formatDateTime(ledger.spanEnd)}</span>
            <span className="font-semibold text-slate-800 dark:text-slate-100">Total owed: {formatPKR(ledger.totalOwed)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400 dark:border-slate-800">
                  <th className="py-1.5 pr-3">Table</th>
                  <th className="py-1.5 pr-3">Game</th>
                  <th className="py-1.5 pr-3">Start</th>
                  <th className="py-1.5 pr-3">Status</th>
                  <th className="py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.unsettledGames.map((g) => (
                  <tr key={g.gameId} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                    <td className="py-1.5 pr-3">#{g.tableNumber}</td>
                    <td className="py-1.5 pr-3">{g.gameTypeName}</td>
                    <td className="py-1.5 pr-3">{formatDateTime(g.startTime)}</td>
                    <td className="py-1.5 pr-3">
                      <PaymentStatusBadge status={g.paymentStatus} />
                    </td>
                    <td className="py-1.5 text-right font-medium">{formatPKR(g.priceFinal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="section-title">Tricked / walked-out log</h2>
            <p className="text-xs text-slate-400">
              Customers who left without paying and without leaving collateral — always shown, never hidden.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RangePicker value={preset} onChange={setPreset} />
            <button className="btn-secondary text-xs" onClick={() => exportCsv("/reports/tricked", { from: range.from, to: range.to }, "tricked.csv")}>
              Export CSV
            </button>
          </div>
        </div>
        {trickedLoading ? (
          <div className="h-32 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : tricked.length === 0 ? (
          <EmptyState title="No tricked/walked-out entries in this range" />
        ) : (
          <DataTable
            columns={trickedColumns}
            rows={tricked}
            keyField={(r) => r.gameId}
            defaultSortKey="date"
            rowClassName={() => "bg-rose-50/50 dark:bg-rose-950/20"}
          />
        )}
      </section>
    </div>
  );
}

function ledgerColumns(onSelect: (id: number) => void): DataTableColumn<LoanLedgerEntry>[] {
  return [
    {
      key: "name",
      header: "Customer",
      render: (r) => (
        <button className="font-medium text-brand-700 hover:underline dark:text-brand-400" onClick={() => onSelect(r.customerId)}>
          {r.displayName}
          {r.isTemporary ? <span className="ml-1 text-xs font-normal text-slate-400">(nishani)</span> : null}
        </button>
      ),
    },
    { key: "phone", header: "Phone", render: (r) => r.phone ?? "—" },
    {
      key: "statuses",
      header: "Status",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {[...new Set(r.statuses)].map((s) => (
            <PaymentStatusBadge key={s} status={s} />
          ))}
        </div>
      ),
      sortable: false,
    },
    { key: "rounds", header: "Rounds", render: (r) => r.unsettledCount, sortValue: (r) => r.unsettledCount, className: "text-right" },
    { key: "owed", header: "Owed", render: (r) => formatPKR(r.totalOwed), sortValue: (r) => r.totalOwed, className: "text-right font-semibold" },
  ];
}

const trickedColumns: DataTableColumn<TrickedEntry>[] = [
  { key: "date", header: "Date", render: (r) => formatDateTime(r.startTime), sortValue: (r) => new Date(r.startTime).getTime() },
  { key: "table", header: "Table", render: (r) => r.tableLabel },
  {
    key: "customer",
    header: "Customer",
    render: (r) => (
      <>
        {r.customerName}
        {r.isTemporary ? <span className="ml-1 text-xs text-slate-400">(nishani)</span> : null}
      </>
    ),
  },
  { key: "amount", header: "Amount", render: (r) => formatPKR(r.priceFinal), sortValue: (r) => r.priceFinal, className: "text-right" },
  { key: "staff", header: "Recorded by", render: (r) => r.createdByName },
];
