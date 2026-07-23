import { useEffect, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { api } from "../api";
import type { ExpenseEntity, PaymentMethod } from "../api";
import { useAuthStore } from "../state/authStore";

const METHODS: PaymentMethod[] = ["cash", "easypaisa"];
const COMMON_CATEGORIES = ["Canteen restock", "Cue / table repair", "Cleaning supplies", "Utilities", "Other"];

/** Decision #11 — a lightweight expense ledger instead of a full canteen/inventory POS. */
export function ExpenseEntryScreen() {
  const session = useAuthStore((s) => s.session)!;
  const [category, setCategory] = useState(COMMON_CATEGORIES[0]!);
  const [customCategory, setCustomCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<ExpenseEntity[]>([]);

  async function refresh() {
    setRecent(await api.expenses.list({ shiftId: session.shift.id }));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const finalCategory = category === "Other" ? customCategory.trim() : category;
    if (!finalCategory) {
      setError("Enter a category");
      return;
    }
    const amountNum = Number(amount);
    if (!amountNum || amountNum <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.expenses.create({
        category: finalCategory,
        amount: amountNum,
        method,
        note: note.trim() || undefined,
        recordedByUserId: session.user.id,
        shiftId: session.shift.id,
      });
      setAmount("");
      setNote("");
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record expense");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl grid-cols-2 gap-6">
      <form onSubmit={handleSubmit} className="card space-y-4 p-5">
        <h2 className="text-xl font-bold">Record Expense</h2>

        <div>
          <label className="field-label">Category</label>
          <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {COMMON_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {category === "Other" && (
            <input
              className="field-input mt-2"
              placeholder="Describe the category"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
            />
          )}
        </div>

        <div>
          <label className="field-label">Amount (Rs.)</label>
          <input type="number" className="field-input text-xl" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>

        <div>
          <label className="field-label">Method</label>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`rounded-lg px-2 py-3 text-sm font-bold capitalize ${
                  method === m ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-100"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="field-label">Note (optional)</label>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any details…" />
        </div>

        {error && <div className="rounded-lg bg-red-100 px-4 py-2 text-red-800 dark:bg-red-900/40 dark:text-red-300">{error}</div>}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Saving…" : "Record Expense"}
        </button>
      </form>

      <div className="card p-5">
        <h2 className="mb-3 text-xl font-bold">This Shift&rsquo;s Expenses</h2>
        <div className="space-y-2">
          {recent.map((exp) => (
            <div key={exp.id} className="flex items-center justify-between rounded-lg bg-slate-100 px-4 py-2 dark:bg-slate-700">
              <div>
                <div className="font-semibold">{exp.category}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {format(new Date(exp.spentAt), "h:mm a")} · {exp.method}
                  {exp.note ? ` · ${exp.note}` : ""}
                </div>
              </div>
              <div className="font-bold text-red-600 dark:text-red-400">− Rs. {exp.amount}</div>
            </div>
          ))}
          {recent.length === 0 && <div className="text-slate-400">No expenses recorded this shift.</div>}
        </div>
      </div>
    </div>
  );
}
