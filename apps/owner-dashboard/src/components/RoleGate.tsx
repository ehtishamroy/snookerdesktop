"use client";

import type { Role } from "@snooker/shared";
import { useAuth } from "@/lib/auth";

interface RoleGateProps {
  allow: readonly Role[];
  children: React.ReactNode;
  /** Rendered instead of children when the current role isn't allowed. Defaults to nothing. */
  fallback?: React.ReactNode;
}

/** Renders children only when the logged-in user's role is in `allow`; otherwise renders `fallback` (or nothing). */
export function RoleGate({ allow, children, fallback = null }: RoleGateProps) {
  const { user } = useAuth();
  if (!user || !allow.includes(user.role)) return <>{fallback}</>;
  return <>{children}</>;
}
