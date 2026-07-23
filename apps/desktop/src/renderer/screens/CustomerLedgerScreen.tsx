import { useEffect, useState } from "react";
import { format } from "date-fns";
import { api } from "../api";
import type { CustomerLedgerView, LoanLedgerRow, PaymentMethod } from "../api";
import { AutosuggestInput, type AutosuggestSuggestion } from "../components/AutosuggestInput";
import { PaymentStatusBadge } from "../components/Badge";
import { useAuthStore } from "../state/authStore";

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "easypaisa", "jazzcash", "card"];

/**
 * Customer Ledger / Settle-Up screen (spec §5.3) — the "losing chain"
 * scenario: shows every unpaid round across tables/opponents/time, the
 * total span and total owed, and lets the receptionist settle any subset.
 */
export function CustomerLedgerScreen() {
  const session = useAuthStore((s) => s.session)!;
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [loanLedger, setLoanLedger] = useState<LoanLedgerRow[]>([]);
  const [ledger, setLedger] = useState<CustomerLedgerView | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshLoanLedger() {
    setLoanLedger(await api.customers.getLoanLedger());
  }

  useEffect(() => {
    void refreshLoanLedger();
  }, []);

  useEffect(() => {
    if (customerId === null) {
      setLedger(null);
      return;
    }
    setSelectedIds(new Set());
    void api.customers.getLedger(customerId).then(setLedger);
  }, [customerId]);

  async function fetchCustomerSuggestions(query: string): Promise<AutosuggestSuggestion[]> {
    const results = await api.customers.search(query);
    return results.map((c) => ({ id: c.id, label: c.displayName, owedAmount: c.owedAmount }));
  }

  function toggleSelected(gameId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  }

  const selectedTotal = ledger?.unsettledGames.filter((g) => selectedIds.has(g.gameId)).reduce((s, g) => s + g.priceFinal, 0) ?? 0;

  async function handleSettle() {
    if (!ledger || selectedIds.size === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.payments.settle({
        customerId: ledger.customerId,
        selectedGameIds: [...selectedIds],
        method,
        note: note.trim() || undefined,
        collectedByUserId: session.user.id,
        shiftId: session.shift.id,
      });
      setMessage(`Recorded payment of Rs. ${selectedTotal} (${method}).`);
      const refreshed = await api.customers.getLedger(ledger.customerId);
      setLedger(refreshed);
      setSelectedIds(new Set());
      void refreshLoanLedger();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-3 gap-6">
      <div className="col-span-1 space-y-4">
        <div className="card p-4">
          <h2 className="mb-3 text-lg font-bold">Find a Customer</h2>
          <AutosuggestInput
            label="Search by name"
            placeholder="Type a name…"
            fetchSuggestions={fetchCustomerSuggestions}
            onSelect={(s) => setCustomerId(s.id)}
          />
        </div>

        <div className="card p-4">
          <h2 className="mb-3 text-lg font-bold">Loan Ledger (all outstanding)</h2>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            Includes nishani (&ldquo;don&rsquo;t know the name&rdquo;) records — click one to open its ledger even without a name.
          </p>
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {loanLedger.map((row) => (
              <button
                key={row.customerId}
                onClick={() => setCustomerId(row.customerId)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700 ${
                  customerId === row.customerId ? "bg-blue-50 dark:bg-blue-950/40" : ""
                }`}
              >
                <span className="truncate">
                  {row.displayName}
                  {row.isTemporary && <span className="ml-1 text-xs text-slate-400">(nishani)</span>}
                </span>
                <span className="shrink-0 font-bold text-red-600 dark:text-red-400">Rs. {row.totalOwed}</span>
              </button>
            ))}
            {loanLedger.length === 0 && <div className="text-slate-400">No outstanding balances 🎉</div>}
          </div>
        </div>
      </div>

      <div className="col-span-2">
        {!ledger && <div className="card flex h-64 items-center justify-center text-slate-400">Select a customer to view their ledger.</div>}

        {ledger && (
          <div className="card p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold">
                  {ledger.displayName}
                  {ledger.isTemporary && <span className="ml-2 text-base font-normal text-slate-400">(nishani)</span>}
                </h2>
                {ledger.spanStart && ledger.spanEnd && (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {format(new Date(ledger.spanStart), "d MMM yyyy, h:mm a")} → {format(new Date(ledger.spanEnd), "d MMM yyyy, h:mm a")} (
                    {Math.round(ledger.spanMinutes)} min span)
                  </p>
                )}
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">Total Owed</div>
                <div className="text-3xl font-extrabold text-red-600 dark:text-red-400">Rs. {ledger.totalOwed}</div>
              </div>
            </div>

            <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left dark:bg-slate-700">
                  <tr>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2">Table</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Game Type</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.unsettledGames.map((g) => (
                    <tr key={g.gameId} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selectedIds.has(g.gameId)} onChange={() => toggleSelected(g.gameId)} />
                      </td>
                      <td className="px-3 py-2">{g.tableLabel}</td>
                      <td className="px-3 py-2">{format(new Date(g.startTime), "d MMM, h:mm a")}</td>
                      <td className="px-3 py-2">{g.gameTypeName}</td>
                      <td className="px-3 py-2">{g.durationBilledMinutes} min</td>
                      <td className="px-3 py-2">
                        <PaymentStatusBadge status={g.paymentStatus} />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">Rs. {g.priceFinal}</td>
                    </tr>
                  ))}
                  {ledger.unsettledGames.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                        Nothing outstanding for this customer.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {ledger.unsettledGames.length > 0 && (
              <div className="rounded-lg bg-slate-100 p-4 dark:bg-slate-700">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-semibold">Selected: {selectedIds.size} round(s)</span>
                  <span className="text-xl font-extrabold">Rs. {selectedTotal}</span>
                </div>
                <div className="mb-3 grid grid-cols-4 gap-2">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      className={`rounded-lg px-2 py-2 text-sm font-bold capitalize ${
                        method === m ? "bg-blue-600 text-white" : "bg-white text-slate-700 dark:bg-slate-600 dark:text-slate-100"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <input
                  className="field-input mb-3"
                  placeholder="Note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button className="btn-success w-full" disabled={selectedIds.size === 0 || busy} onClick={handleSettle}>
                  {busy ? "Recording…" : `Record Payment of Rs. ${selectedTotal}`}
                </button>
                {message && <div className="mt-3 rounded-lg bg-white px-4 py-2 text-sm dark:bg-slate-800">{message}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
