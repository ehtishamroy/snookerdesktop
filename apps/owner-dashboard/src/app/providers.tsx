"use client";

import { SWRConfig } from "swr";
import { AuthProvider } from "@/lib/auth";
import { ApiError } from "@/lib/apiClient";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        // Global SWR defaults: revalidate on network reconnect (important
        // for a PWA used on a flaky mobile connection), but don't hammer the
        // API on every window focus for every hook — individual hooks opt in
        // where live-ness matters (table tiles, ledger).
        revalidateOnReconnect: true,
        shouldRetryOnError: (err) => !(err instanceof ApiError && err.status === 401),
        errorRetryCount: 2,
      }}
    >
      <AuthProvider>{children}</AuthProvider>
    </SWRConfig>
  );
}
