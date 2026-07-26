"use client";

import { useState } from "react";
import { BalanceByMethodChart } from "@/components/BalanceByMethodChart";
import { PageGuard } from "@/components/PageGuard";
import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { useBalanceSheet, useFinancialAnalysis, usePayouts } from "@/hooks/useCapital";
import { apiClient, ApiError } from "@/lib/apiClient";
import { formatDateTime, formatPKR, PAYMENT_METHOD_LABELS } from "@/lib/format";
import type { PaymentMethod } from "@snooker/shared";
import { PAYMENT_METHODS } from "@snooker/shared";

export default function CapitalPage() {
  return (
    <PageGuard allow={["owner"]}>
      <CapitalPageContent />
    </PageGuard>
  );
}

function CapitalPageContent() {
  const { sheet, isLoading, refresh } = useBalanceSheet();
  const { payouts, refresh: refreshPayouts } = usePayouts();
  const { analysis, isLoading: analysisLoading } = useFinancialAnalysis();
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [showPayout, setShowPayout] = useState(false);

  async function refreshAll() {
    await Promise.all([refresh(), refreshPayouts()]);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title">Capital &amp; Financials</h1>
        <p className="page-subtitle">Owner-only. Balance sheet and monthly earnings — not visible to staff.</p>
      </div>

      {/* Balance sheet */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Balance sheet</h2>
          <button className="btn-primary text-xs" onClick={() => setShowPayout(true)}>
            Record payout
          </button>
        </div>

        {isLoading || !sheet ? (
          <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Total capital" value={formatPKR(sheet.totalCapital)} tone="positive" />
              {sheet.byMethod.map((m) => (
                <StatCard key={m.method} label={PAYMENT_METHOD_LABELS[m.method] ?? m.method} value={formatPKR(m.balance)} />
              ))}
            </div>

            <div className="card">
              <BalanceByMethodChart byMethod={sheet.byMethod} />
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                    <th className="px-3 py-2">Method</th>
                    <th className="px-3 py-2 text-right">Starting</th>
                    <th className="px-3 py-2 text-right">Collected</th>
                    <th className="px-3 py-2 text-right">Expenses</th>
                    <th className="px-3 py-2 text-right">Payouts</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.byMethod.map((m) => (
                    <tr key={m.method} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                      <td className="px-3 py-2 font-medium">{PAYMENT_METHOD_LABELS[m.method]}</td>
                      <td className="px-3 py-2 text-right">{formatPKR(m.startingAmount)}</td>
                      <td className="px-3 py-2 text-right text-felt-700 dark:text-felt-400">{formatPKR(m.totalCollected)}</td>
                      <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-400">-{formatPKR(m.totalExpenses)}</td>
                      <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-400">-{formatPKR(m.totalPayouts)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatPKR(m.balance)}</td>
                      <td className="px-3 py-2 text-right">
                        <button className="text-xs text-brand-600 hover:underline dark:text-brand-400" onClick={() => setEditingMethod(m.method)}>
                          Set starting
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">
              Balance = starting amount + all payments collected - all expenses - all payouts, for that method,
              all-time.
            </p>
          </>
        )}
      </section>

      {/* Detailed analysis */}
      <section className="flex flex-col gap-3">
        <h2 className="section-title">Detailed analysis</h2>
        {analysisLoading || !analysis ? (
          <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="Avg daily sale" value={formatPKR(analysis.avgDailySale)} />
              <StatCard label="Avg daily expense" value={formatPKR(analysis.avgDailyExpense)} />
              <StatCard label="Avg daily loan (udhaar)" value={formatPKR(analysis.avgDailyLoan)} />
              <StatCard label={`Avg monthly sale (${analysis.lookbackMonths}mo)`} value={formatPKR(analysis.avgMonthlySale)} />
              <StatCard label={`Avg monthly expense (${analysis.lookbackMonths}mo)`} value={formatPKR(analysis.avgMonthlyExpense)} />
              <StatCard label={`Avg monthly loan (${analysis.lookbackMonths}mo)`} value={formatPKR(analysis.avgMonthlyLoan)} />
            </div>
            <div className="card flex flex-col gap-1">
              <span className="section-title">This month, projected</span>
              <span className="text-2xl font-semibold tabular-nums text-felt-700 dark:text-felt-400">
                {formatPKR(analysis.currentMonth.projectedMonthEndEarning)}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {formatPKR(analysis.currentMonth.salesSoFar)} collected over {analysis.currentMonth.daysElapsed} of{" "}
                {analysis.currentMonth.daysInMonth} days so far, extrapolated to the full month.
              </span>
            </div>
          </>
        )}
      </section>

      {/* Payout history */}
      <section className="flex flex-col gap-3">
        <h2 className="section-title">Payout history</h2>
        {payouts.length === 0 ? (
          <EmptyState title="No payouts recorded yet" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                    <td className="px-3 py-2">{formatDateTime(p.performedAt)}</td>
                    <td className="px-3 py-2">{PAYMENT_METHOD_LABELS[p.method]}</td>
                    <td className="px-3 py-2">{p.note ?? "—"}</td>
                    <td className="px-3 py-2">{p.performedBy.fullName}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatPKR(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editingMethod ? (
        <SetStartingBalanceModal
          method={editingMethod}
          currentAmount={sheet?.byMethod.find((m) => m.method === editingMethod)?.startingAmount ?? 0}
          onClose={() => setEditingMethod(null)}
          onSaved={async () => {
            setEditingMethod(null);
            await refreshAll();
          }}
        />
      ) : null}

      {showPayout ? (
        <RecordPayoutModal
          onClose={() => setShowPayout(false)}
          onSaved={async () => {
            setShowPayout(false);
            await refreshAll();
          }}
        />
      ) : null}
    </div>
  );
}

function SetStartingBalanceModal({
  method,
  currentAmount,
  onClose,
  onSaved,
}: {
  method: PaymentMethod;
  currentAmount: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState(String(currentAmount));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setError("Enter a valid amount.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.setStartingBalance({ method, amount: amountNum });
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md">
        <h2 className="mb-1 text-base font-semibold">Set starting balance — {PAYMENT_METHOD_LABELS[method]}</h2>
        <p className="mb-4 text-xs text-slate-400">
          This is the baseline your current {PAYMENT_METHOD_LABELS[method]} on hand is measured from. Every payment
          collected adds to it going forward; every expense and payout subtracts. Updating this overwrites the
          previous baseline — it doesn&apos;t add to it.
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="label">Current amount you have (PKR)</label>
            <input className="input" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          {error ? <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordPayoutModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.recordPayout({ amount: amountNum, method, note: note.trim() || undefined });
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record payout.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md">
        <h2 className="mb-1 text-base font-semibold">Record a payout</h2>
        <p className="mb-4 text-xs text-slate-400">
          Money you&apos;re taking out of capital (e.g. profit for yourself) — subtracts from that method&apos;s
          balance the same way an expense does.
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="label">Method</label>
            <div className="grid grid-cols-4 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`rounded-lg px-2 py-2 text-xs font-bold ${
                    method === m ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  }`}
                >
                  {PAYMENT_METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Amount (PKR)</label>
            <input className="input" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error ? <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving…" : "Record payout"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
