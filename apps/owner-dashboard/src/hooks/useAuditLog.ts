"use client";

import useSWR from "swr";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export interface AuditLogFilters {
  entityType?: string;
  entityId?: number;
  performedBy?: number;
  from?: string;
  to?: string;
}

export function useAuditLog(filters: AuditLogFilters) {
  const { isAuthenticated } = useAuth();
  const key = isAuthenticated
    ? [
        "/reports/audit-log",
        filters.entityType ?? "",
        filters.entityId ?? "",
        filters.performedBy ?? "",
        filters.from ?? "",
        filters.to ?? "",
      ]
    : null;
  const { data, error, isLoading } = useSWR(key, () => apiClient.getAuditLog(filters), { refreshInterval: 60_000 });
  return { entries: data ?? [], isLoading, error: error as Error | undefined };
}
