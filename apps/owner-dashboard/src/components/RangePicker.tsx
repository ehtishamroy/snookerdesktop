"use client";

import type { RangePreset } from "@/lib/dateRanges";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "custom", label: "Custom" },
];

interface RangePickerProps {
  value: RangePreset;
  onChange: (preset: RangePreset) => void;
  customFrom?: string;
  customTo?: string;
  onCustomChange?: (from: string, to: string) => void;
}

export function RangePicker({ value, onChange, customFrom, customTo, onCustomChange }: RangePickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onChange(p.key)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              value === p.key
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value === "custom" ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom?.slice(0, 10) ?? ""}
            onChange={(e) => onCustomChange?.(e.target.value, customTo ?? e.target.value)}
            className="input !w-auto py-1.5 text-xs"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={customTo?.slice(0, 10) ?? ""}
            onChange={(e) => onCustomChange?.(customFrom ?? e.target.value, e.target.value)}
            className="input !w-auto py-1.5 text-xs"
          />
        </div>
      ) : null}
    </div>
  );
}
