"use client";

import useSWR from "swr";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export function useUsers() {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(isAuthenticated ? "/users" : null, () => apiClient.getUsers());
  return { users: data ?? [], isLoading, error: error as Error | undefined, refresh: mutate };
}
