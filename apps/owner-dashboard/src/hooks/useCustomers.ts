"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export function useCustomerSearch(search: string) {
  const { isAuthenticated } = useAuth();
  const trimmed = search.trim();
  const { data, error, isLoading } = useSWR(
    isAuthenticated && trimmed.length >= 2 ? ["/customers", trimmed] : null,
    () => apiClient.searchCustomers(trimmed),
    { keepPreviousData: true }
  );
  return { customers: data ?? [], isLoading, error: error as Error | undefined };
}

export function useMergeCustomers() {
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge(fromCustomerId: number, intoCustomerId: number) {
    setIsMerging(true);
    setError(null);
    try {
      await apiClient.mergeCustomer(fromCustomerId, intoCustomerId);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed");
      return false;
    } finally {
      setIsMerging(false);
    }
  }

  return { merge, isMerging, error };
}
