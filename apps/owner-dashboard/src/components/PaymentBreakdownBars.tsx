import type { MethodTotals, StatusTotals } from "@/lib/apiTypes";
import { formatPKR, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/format";
import { PAYMENT_METHODS, PAYMENT_STATUSES } from "@snooker/shared";

const METHOD_COLORS: Record<string, string> = {
  cash: "bg-emerald-500",
  easypaisa: "bg-fuchsia-500",
  jazzcash: "bg-indigo-500",
  card: "bg-slate-500",
};

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-felt-500",
  pending: "bg-amber-500",
  loan: "bg-orange-500",
  collateral: "bg-sky-500",
  tricked: "bg-rose-500",
};

function Bars({
  entries,
  colors,
  labels,
  total,
}: {
  entries: [string, number][];
  colors: Record<string, string>;
  labels: Record<string, string>;
  total: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {entries.map(([key, value]) => {
        const pct = total > 0 ? (value / total) * 100 : 0;
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-slate-500 dark:text-slate-400">{labels[key] ?? key}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className={`h-full ${colors[key] ?? "bg-slate-400"}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-24 shrink-0 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">
              {formatPKR(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Payment-method breakdown (decision #7): shows cash / EasyPaisa / JazzCash /
 * card side by side wherever revenue is displayed, so the owner always knows
 * how much of each should physically/digitally be on hand — never a single
 * lump total on its own.
 */
export function PaymentMethodBreakdown({ byMethod, title = "By payment method" }: { byMethod: MethodTotals; title?: string }) {
  const total = Object.values(byMethod).reduce((a, b) => a + b, 0);
  // Fixed, deterministic order straight from the shared constant (decision
  // #7's canonical method list) rather than however JS happens to iterate
  // Object.entries — keeps this in lockstep with the server/desktop app.
  const entries = PAYMENT_METHODS.map((m) => [m, byMethod[m]] as [string, number]);
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</div>
      <Bars entries={entries} colors={METHOD_COLORS} labels={PAYMENT_METHOD_LABELS} total={total} />
    </div>
  );
}

export function PaymentStatusBreakdown({ byStatus, title = "By payment status" }: { byStatus: StatusTotals; title?: string }) {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const entries = PAYMENT_STATUSES.map((s) => [s, byStatus[s]] as [string, number]);
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</div>
      <Bars entries={entries} colors={STATUS_COLORS} labels={PAYMENT_STATUS_LABELS} total={total} />
    </div>
  );
}
