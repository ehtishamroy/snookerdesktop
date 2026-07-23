import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek, subDays } from "date-fns";

export type RangePreset = "today" | "week" | "month" | "last7" | "last30" | "custom";

export interface DateRange {
  from: string; // ISO
  to: string; // ISO
  label: string;
}

export function presetRange(preset: RangePreset, now: Date = new Date()): DateRange {
  switch (preset) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString(), label: "Today" };
    case "week":
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }).toISOString(),
        to: endOfDay(now).toISOString(),
        label: "This week",
      };
    case "month":
      return { from: startOfMonth(now).toISOString(), to: endOfDay(now).toISOString(), label: "This month" };
    case "last7":
      return { from: startOfDay(subDays(now, 6)).toISOString(), to: endOfDay(now).toISOString(), label: "Last 7 days" };
    case "last30":
      return {
        from: startOfDay(subDays(now, 29)).toISOString(),
        to: endOfDay(now).toISOString(),
        label: "Last 30 days",
      };
    case "custom":
    default:
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString(), label: "Custom" };
  }
}

export function monthToDateRange(now: Date = new Date()): DateRange {
  return presetRange("month", now);
}

export function weekToDateRange(now: Date = new Date()): DateRange {
  return presetRange("week", now);
}

export function fullMonthRange(now: Date = new Date()): DateRange {
  return { from: startOfMonth(now).toISOString(), to: endOfMonth(now).toISOString(), label: "This month" };
}
