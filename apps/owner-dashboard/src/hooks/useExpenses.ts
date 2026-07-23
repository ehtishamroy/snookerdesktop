"use client";

import useSWR from "swr";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export function useExpenses(from?: string, to?: string) {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading } = useSWR(
    isAuthenticated ? ["/expenses", from ?? "", to ?? ""] : null,
    () => apiClient.getExpenses({ from, to }),
    { refreshInterval: 60_000 }
  );
  return { expenses: data ?? [], isLoading, error: error as Error | undefined };
}
