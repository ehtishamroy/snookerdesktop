"use client";

import { format } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyRevenuePoint } from "@/lib/apiTypes";
import { formatCompactPKR, formatPKR, PAYMENT_METHOD_LABELS } from "@/lib/format";

const METHOD_COLORS: Record<string, string> = {
  cash: "#10b981",
  easypaisa: "#d946ef",
  jazzcash: "#6366f1",
  card: "#64748b",
};

interface RevenueChartProps {
  series: DailyRevenuePoint[];
  height?: number;
}

/** Stacked daily revenue chart, broken down by payment method (decision #7) — never a single lump bar. */
export function RevenueChart({ series, height = 260 }: RevenueChartProps) {
  const data = series.map((point) => ({
    date: format(new Date(point.date), "d MMM"),
    ...point.byMethod,
  }));

  if (series.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-400">
        No revenue in this range yet.
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
          <Bar key={method} dataKey={method} stackId="revenue" fill={METHOD_COLORS[method]} radius={[0, 0, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
