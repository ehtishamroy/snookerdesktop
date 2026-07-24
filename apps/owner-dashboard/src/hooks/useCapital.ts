"use client";

import useSWR from "swr";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export function useBalanceSheet() {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(
    isAuthenticated ? "/capital/balance-sheet" : null,
    () => apiClient.getBalanceSheet(),
    { refreshInterval: 60_000 }
  );
  return { sheet: data, isLoading, error: error as Error | undefined, refresh: mutate };
}

export function usePayouts() {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(
    isAuthenticated ? "/capital/payouts" : null,
    () => apiClient.getPayouts(),
    { refreshInterval: 60_000 }
  );
  return { payouts: data ?? [], isLoading, error: error as Error | undefined, refresh: mutate };
}

export function useFinancialAnalysis() {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading } = useSWR(
    isAuthenticated ? "/capital/analysis" : null,
    () => apiClient.getFinancialAnalysis(),
    { refreshInterval: 60_000 }
  );
  return { analysis: data, isLoading, error: error as Error | undefined };
}
