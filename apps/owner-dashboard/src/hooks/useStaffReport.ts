"use client";

import useSWR from "swr";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export function useStaffPerformance(from: string, to: string) {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading } = useSWR(
    isAuthenticated ? ["/reports/staff-performance", from, to] : null,
    () => apiClient.getStaffPerformance({ from, to }),
    { refreshInterval: 60_000 }
  );
  return { staff: data ?? [], isLoading, error: error as Error | undefined };
}

export function useShifts(params: { userId?: number; from?: string; to?: string }) {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading } = useSWR(
    isAuthenticated ? ["/shifts", params.userId ?? "", params.from ?? "", params.to ?? ""] : null,
    () => apiClient.getShifts(params)
  );
  return { shifts: data ?? [], isLoading, error: error as Error | undefined };
}
