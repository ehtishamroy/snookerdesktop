"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ExpenseEntity, MethodTotals } from "@/lib/apiTypes";
import { ZERO_METHOD_TOTALS } from "@/lib/apiTypes";
import { formatCompactPKR, formatPKR, PAYMENT_METHOD_LABELS } from "@/lib/format";

// Same method→color mapping as RevenueChart — an expense and a revenue chart
// side by side should read as the same "language" of colors, not a second palette.
const METHOD_COLORS: Record<string, string> = {
  cash: "#10b981",
  easypaisa: "#d946ef",
  jazzcash: "#6366f1",
  card: "#64748b",
};

/** Daily expense total, broken down by payment method — same shape and chrome as RevenueChart, so a reader who understands one understands both. */
export function ExpenseChart({ expenses, height = 240 }: { expenses: ExpenseEntity[]; height?: number }) {
  const data = useMemo(() => {
    const byDay = new Map<string, MethodTotals>();
    for (const e of expenses) {
      const key = format(new Date(e.spentAt), "yyyy-MM-dd");
      const bucket = byDay.get(key) ?? { ...ZERO_METHOD_TOTALS };
      bucket[e.method] += e.amount;
      byDay.set(key, bucket);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, byMethod]) => ({ date: format(new Date(day), "d MMM"), ...byMethod }));
  }, [expenses]);

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-400">
        No expenses in this range yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="currentColor" className="text-slate-400" />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCompactPKR(Number(v))} stroke="currentColor" className="text-slate-400" width={64} />
        <Tooltip
          formatter={(value: number, name: string) => [formatPKR(value), PAYMENT_METHOD_LABELS[name] ?? name]}
          contentStyle={{ borderRadius: 8, fontSize: 12 }}
        />
        <Legend formatter={(value) => PAYMENT_METHOD_LABELS[value] ?? value} wrapperStyle={{ fontSize: 12 }} />
        {Object.keys(METHOD_COLORS).map((method) => (
          <Bar key={method} dataKey={method} stackId="expenses" fill={METHOD_COLORS[method]} radius={[0, 0, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
