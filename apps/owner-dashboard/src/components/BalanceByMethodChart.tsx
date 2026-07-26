"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CapitalMethodBalance } from "@/lib/apiTypes";
import { formatCompactPKR, formatPKR, PAYMENT_METHOD_LABELS } from "@/lib/format";

// Same method→color mapping as RevenueChart/ExpenseChart — one color per
// payment method across every chart in the app, not a re-derived palette.
const METHOD_COLORS: Record<string, string> = {
  cash: "#10b981",
  easypaisa: "#d946ef",
  jazzcash: "#6366f1",
  card: "#64748b",
};

/** Single-series bar chart, one bar per payment method — "identity" job, so each method keeps its own fixed color rather than a magnitude ramp. */
export function BalanceByMethodChart({ byMethod, height = 200 }: { byMethod: CapitalMethodBalance[]; height?: number }) {
  const data = byMethod.map((m) => ({
    method: m.method,
    label: PAYMENT_METHOD_LABELS[m.method] ?? m.method,
    balance: m.balance,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="currentColor" className="text-slate-400" />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCompactPKR(Number(v))} stroke="currentColor" className="text-slate-400" width={64} />
        <Tooltip formatter={(value: number) => formatPKR(value)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        <Bar dataKey="balance" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.method} fill={METHOD_COLORS[d.method] ?? "#64748b"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
