"use client";

import useSWR from "swr";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import { presetRange } from "@/lib/dateRanges";

export function useRevenueReport(from: string, to: string, tableId?: number) {
  const { isAuthenticated } = useAuth();
  const key = isAuthenticated ? ["revenue", from, to, tableId ?? "all"] : null;
  const { data, error, isLoading, mutate } = useSWR(key, () => apiClient.getRevenueReport({ from, to, tableId }), {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
  });
  return { report: data, isLoading, error: error as Error | undefined, refresh: mutate };
}

/** Convenience hook for the dashboard summary strip: today / week / month totals in parallel. */
export function useRevenueSummary() {
  const now = new Date();
  const today = presetRange("today", now);
  const week = presetRange("week", now);
  const month = presetRange("month", now);

  const todayQ = useRevenueReport(today.from, today.to);
  const weekQ = useRevenueReport(week.from, week.to);
  const monthQ = useRevenueReport(month.from, month.to);

  return {
    today: todayQ.report,
    week: weekQ.report,
    month: monthQ.report,
    isLoading: todayQ.isLoading || weekQ.isLoading || monthQ.isLoading,
    error: todayQ.error ?? weekQ.error ?? monthQ.error,
  };
}

export function useUtilizationReport(from: string, to: string, tableId?: number) {
  const { isAuthenticated } = useAuth();
  const key = isAuthenticated ? ["utilization", from, to, tableId ?? "all"] : null;
  const { data, error, isLoading } = useSWR(key, () => apiClient.getUtilizationReport({ from, to, tableId }), {
    revalidateOnFocus: false,
  });
  return { utilization: data ?? [], isLoading, error: error as Error | undefined };
}

/** The "round graph" — every table's full occupied/vacant timeline for one calendar day (today or any day in the past). */
export function useTableDayTimelines(date: string) {
  const { isAuthenticated } = useAuth();
  const key = isAuthenticated ? ["day-timeline", date] : null;
  const { data, error, isLoading } = useSWR(key, () => apiClient.getTableDayTimelines({ date }), {
    revalidateOnFocus: false,
  });
  return { timelines: data ?? [], isLoading, error: error as Error | undefined };
}
