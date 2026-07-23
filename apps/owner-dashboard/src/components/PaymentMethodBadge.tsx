import type { PaymentMethod } from "@snooker/shared";
import { PAYMENT_METHOD_LABELS } from "@/lib/format";

const STYLES: Record<PaymentMethod, string> = {
  cash: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  easypaisa: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
  jazzcash: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  card: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
};

export function PaymentMethodBadge({ method }: { method: PaymentMethod }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[method]}`}>
      {PAYMENT_METHOD_LABELS[method] ?? method}
    </span>
  );
}
