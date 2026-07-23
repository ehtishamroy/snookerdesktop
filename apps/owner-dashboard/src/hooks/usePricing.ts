"use client";

import useSWR from "swr";
import type { TableType } from "@snooker/shared";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export function useActivePricingRules() {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(
    isAuthenticated ? "/pricing-rules?activeOnly=true" : null,
    () => apiClient.getActivePricingRules()
  );
  return { rules: data ?? [], isLoading, error: error as Error | undefined, refresh: mutate };
}

export function usePricingHistory(tableType?: TableType, gameTypeId?: number) {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading } = useSWR(
    isAuthenticated && gameTypeId ? ["/pricing-rules/history", tableType ?? "", gameTypeId] : null,
    () => apiClient.getPricingHistory({ tableType, gameTypeId })
  );
  return { history: data ?? [], isLoading, error: error as Error | undefined };
}

export function useGameTypes() {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading } = useSWR(isAuthenticated ? "/game-types" : null, () => apiClient.getGameTypes());
  return { gameTypes: data ?? [], isLoading, error: error as Error | undefined };
}
