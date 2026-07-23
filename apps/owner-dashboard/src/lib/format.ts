import { format, formatDistanceToNowStrict } from "date-fns";

export function formatPKR(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.round(Math.abs(amount));
  return `${sign}Rs. ${abs.toLocaleString("en-PK")}`;
}

export function formatCompactPKR(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${amount < 0 ? "-" : ""}Rs. ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${amount < 0 ? "-" : ""}Rs. ${(abs / 1_000).toFixed(1)}K`;
  return formatPKR(amount);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "d MMM yyyy, h:mm a");
  } catch {
    return "—";
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "d MMM yyyy");
  } catch {
    return "—";
  }
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "h:mm a");
  } catch {
    return "—";
  }
}

export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatLiveDuration(startIso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(startIso));
  } catch {
    return "";
  }
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(digits)}%`;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  easypaisa: "EasyPaisa",
  jazzcash: "JazzCash",
  card: "Card",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  pending: "Pending",
  loan: "Loan / Udhaar",
  collateral: "Collateral",
  tricked: "Tricked",
};
