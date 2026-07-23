import type { ReactNode } from "react";

type BadgeTone = "green" | "red" | "amber" | "slate" | "blue" | "purple";

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  slate: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
};

export function Badge({ tone = "slate", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

const PAYMENT_STATUS_TONE: Record<string, BadgeTone> = {
  paid: "green",
  pending: "amber",
  loan: "purple",
  collateral: "blue",
  tricked: "red",
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge tone={PAYMENT_STATUS_TONE[status] ?? "slate"}>{label}</Badge>;
}
