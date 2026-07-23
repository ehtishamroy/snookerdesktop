import type { PaymentStatus } from "@snooker/shared";
import { PAYMENT_STATUS_LABELS } from "@/lib/format";

const STYLES: Record<PaymentStatus, string> = {
  paid: "bg-felt-100 text-felt-800 dark:bg-felt-900/40 dark:text-felt-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  loan: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  collateral: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  tricked: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {PAYMENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}
