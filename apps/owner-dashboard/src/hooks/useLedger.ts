"use client";

import useSWR from "swr";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export function useLoanLedger() {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(
    isAuthenticated ? "/customers/loan-ledger" : null,
    () => apiClient.getLoanLedger(),
    { refreshInterval: 30_000, revalidateOnFocus: true }
  );
  return { entries: data ?? [], isLoading, error: error as Error | undefined, refresh: mutate };
}

export function useCustomerLedger(customerId: number | null) {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading } = useSWR(
    isAuthenticated && customerId ? ["/customers/ledger", customerId] : null,
    () => apiClient.getCustomerLedger(customerId as number)
  );
  return { ledger: data, isLoading, error: error as Error | undefined };
}

export function useTrickedLog(from?: string, to?: string) {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading } = useSWR(
    isAuthenticated ? ["/reports/tricked", from ?? "", to ?? ""] : null,
    () => apiClient.getTricked({ from, to }),
    { refreshInterval: 60_000 }
  );
  return { entries: data ?? [], isLoading, error: error as Error | undefined };
}
