"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiClient } from "./apiClient";
import { clearSession, getSession, setSession, subscribeSession, type StoredUser } from "./tokenStore";

interface AuthContextValue {
  user: StoredUser | null;
  token: string | null;
  /** True until we've read localStorage once on the client (avoids an SSR/CSR flash-redirect). */
  isHydrating: boolean;
  isAuthenticated: boolean;
  login: (username: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const session = getSession();
    setUser(session?.user ?? null);
    setToken(session?.token ?? null);
    setIsHydrating(false);

    return subscribeSession((next) => {
      setUser(next?.user ?? null);
      setToken(next?.token ?? null);
    });
  }, []);

  const login = useCallback(async (username: string, pin: string) => {
    const { token: newToken, user: newUser } = await apiClient.login(username, pin);
    setSession({ token: newToken, user: newUser });
  }, []);

  const logout = useCallback(async () => {
    try {
      // Per decision #5, logout also force-closes the caller's open shift
      // server-side; the client only needs to call the endpoint and clear
      // local state regardless of the outcome.
      await apiClient.logout();
    } catch {
      // Even if the network call fails (e.g. offline), still clear the
      // local session so the owner isn't stuck logged in on this device.
    } finally {
      clearSession();
      router.replace("/login");
    }
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, isHydrating, isAuthenticated: Boolean(user && token), login, logout }),
    [user, token, isHydrating, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
