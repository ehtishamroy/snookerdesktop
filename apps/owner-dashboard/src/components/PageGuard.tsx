"use client";

import type { Role } from "@snooker/shared";
import { useAuth } from "@/lib/auth";

/**
 * Wraps a whole page's content with a role check so that navigating
 * directly to a URL (bypassing the nav, which already hides links a role
 * can't use) degrades gracefully instead of crashing or leaking data —
 * e.g. a receptionist token that somehow reaches /admin/pricing or /staff.
 */
export function PageGuard({ allow, children }: { allow: readonly Role[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!allow.includes(user.role)) {
    return (
      <div className="card flex flex-col items-center gap-1 py-12 text-center">
        <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
          Your account ({user.role}) doesn&apos;t have access to this page.
        </div>
        <div className="text-xs text-slate-400">Ask an owner or manager if you believe this is a mistake.</div>
      </div>
    );
  }
  return <>{children}</>;
}
