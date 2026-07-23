"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { canAccess, isReceptionistDegraded, type NavKey } from "@/lib/roles";
import {
  IconBox,
  IconChart,
  IconClose,
  IconGrid,
  IconHistory,
  IconLedger,
  IconLogout,
  IconMenu,
  IconMerge,
  IconReceipt,
  IconSettings,
  IconTag,
  IconUsers,
} from "@/components/icons";

interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  icon: (props: { className?: string }) => JSX.Element;
}

const PRIMARY_NAV: NavItem[] = [
  { key: "dashboard", href: "/", label: "Live status", icon: IconGrid },
  { key: "analytics", href: "/analytics", label: "Analytics", icon: IconChart },
  { key: "ledger", href: "/ledger", label: "Ledger", icon: IconLedger },
  { key: "staff", href: "/staff", label: "Staff", icon: IconUsers },
  { key: "expenses", href: "/expenses", label: "Expenses", icon: IconReceipt },
  { key: "collateral", href: "/collateral", label: "Collateral", icon: IconBox },
  { key: "history", href: "/history", label: "History", icon: IconHistory },
];

const ADMIN_NAV: NavItem[] = [
  { key: "adminPricing", href: "/admin/pricing", label: "Pricing", icon: IconTag },
  { key: "adminStaff", href: "/admin/staff", label: "Staff accounts", icon: IconSettings },
  { key: "adminMerge", href: "/admin/merge", label: "Customer merge", icon: IconMerge },
];

const MOBILE_NAV = PRIMARY_NAV.slice(0, 5);

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isHydrating, isAuthenticated, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (isLoginPage || isHydrating) return;
    if (!isAuthenticated) router.replace("/login");
  }, [isAuthenticated, isHydrating, isLoginPage, router]);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline-first is a nice-to-have; ignore registration failures */
      });
    }
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (isLoginPage) return <>{children}</>;

  if (isHydrating) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">Loading…</div>
    );
  }

  if (!isAuthenticated) {
    // useEffect above will redirect; render nothing meanwhile.
    return null;
  }

  const degraded = isReceptionistDegraded(user?.role);
  const visiblePrimary = PRIMARY_NAV.filter((item) => canAccess(user?.role, item.key));
  const visibleAdmin = ADMIN_NAV.filter((item) => canAccess(user?.role, item.key));
  const visibleMobile = MOBILE_NAV.filter((item) => canAccess(user?.role, item.key));

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <SidebarHeader />
        <nav className="mt-6 flex flex-1 flex-col gap-1">
          {visiblePrimary.map((item) => (
            <NavLink key={item.key} item={item} active={isActive(pathname, item.href)} />
          ))}
          {visibleAdmin.length > 0 ? (
            <>
              <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Admin</div>
              {visibleAdmin.map((item) => (
                <NavLink key={item.key} item={item} active={isActive(pathname, item.href)} />
              ))}
            </>
          ) : null}
        </nav>
        <UserFooter />
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-felt-600" />
          <span className="text-sm font-semibold">Snooker Owner</span>
        </div>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <IconClose className="h-6 w-6" /> : <IconMenu className="h-6 w-6" />}
        </button>
      </header>

      {mobileOpen ? (
        <div className="border-b border-slate-200 bg-white px-2 py-2 dark:border-slate-800 dark:bg-slate-900 lg:hidden">
          <nav className="flex flex-col gap-1">
            {visiblePrimary.map((item) => (
              <NavLink key={item.key} item={item} active={isActive(pathname, item.href)} />
            ))}
            {visibleAdmin.length > 0 ? (
              <>
                <div className="mt-2 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Admin</div>
                {visibleAdmin.map((item) => (
                  <NavLink key={item.key} item={item} active={isActive(pathname, item.href)} />
                ))}
              </>
            ) : null}
            <button
              onClick={() => logout()}
              className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
            >
              <IconLogout className="h-4 w-4" /> Log out
            </button>
          </nav>
        </div>
      ) : null}

      <main className="min-w-0 flex-1 pb-20 lg:pb-0">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          {degraded ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
              This dashboard is intended for owner/manager use. Your account ({user?.role}) only sees your own shift
              totals here — for full counter operations, please use the desktop app.
            </div>
          ) : null}
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 lg:hidden">
        {visibleMobile.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                active ? "text-brand-600 dark:text-brand-400" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
      {item.label}
    </Link>
  );
}

function SidebarHeader() {
  return (
    <div className="flex items-center gap-2 px-1">
      <div className="h-8 w-8 rounded-lg bg-felt-600" />
      <div>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">Snooker Owner</div>
        <div className="text-xs text-slate-400">Club dashboard</div>
      </div>
    </div>
  );
}

function UserFooter() {
  const { user, logout } = useAuth();
  return (
    <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
      <div className="px-1 text-sm font-medium text-slate-800 dark:text-slate-100">{user?.fullName}</div>
      <div className="px-1 text-xs capitalize text-slate-400">{user?.role}</div>
      <button
        onClick={() => logout()}
        className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
      >
        <IconLogout className="h-4 w-4" /> Log out
      </button>
    </div>
  );
}
