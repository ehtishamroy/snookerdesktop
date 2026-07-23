"use client";

import useSWR from "swr";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

/**
 * Live table status for the dashboard tiles. Real-time push isn't required
 * for this build (per task spec) — SWR polls every 10s while the tab is
 * visible, which is frequent enough for a receptionist-paced counter without
 * hammering the API.
 */
export function useTables(pollMs = 10_000) {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(
    isAuthenticated ? "/tables" : null,
    () => apiClient.getTables(),
    {
      refreshInterval: pollMs,
      revalidateOnFocus: true,
      dedupingInterval: 2000,
    }
  );

  return {
    tables: data ?? [],
    isLoading,
    error: error as Error | undefined,
    refresh: mutate,
  };
}
