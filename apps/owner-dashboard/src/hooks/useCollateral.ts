"use client";

import useSWR from "swr";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export function useHeldCollateral() {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(
    isAuthenticated ? "/collateral-items?returned=false" : null,
    () => apiClient.getHeldCollateral(),
    { refreshInterval: 30_000 }
  );
  return { items: data ?? [], isLoading, error: error as Error | undefined, refresh: mutate };
}
