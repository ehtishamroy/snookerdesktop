import { useEffect, useState } from "react";
import { useAuthStore, useIsOwnerOrManager } from "./state/authStore";
import { LoginScreen } from "./screens/LoginScreen";
import { MainDashboard } from "./screens/MainDashboard";
import { CustomerLedgerScreen } from "./screens/CustomerLedgerScreen";
import { ReportsScreen } from "./screens/ReportsScreen";
import { AdminSettingsScreen } from "./screens/AdminSettingsScreen";
import { ExpenseEntryScreen } from "./screens/ExpenseEntryScreen";
import { ShiftCloseScreen } from "./screens/ShiftCloseScreen";
import { SyncStatusIndicator } from "./components/SyncStatusIndicator";

type ScreenName = "dashboard" | "ledger" | "reports" | "expense" | "admin";

const NAV_ITEMS: { key: ScreenName; label: string; ownerManagerOnly?: boolean }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "ledger", label: "Customer Ledger" },
  { key: "reports", label: "Reports" },
  { key: "expense", label: "Expense" },
  { key: "admin", label: "Admin Settings", ownerManagerOnly: true },
];

export default function App() {
  const session = useAuthStore((s) => s.session);
  const pendingShiftClose = useAuthStore((s) => s.pendingShiftClose);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const [screen, setScreen] = useState<ScreenName>("dashboard");
  const isOwnerOrManager = useIsOwnerOrManager();

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  if (!session) return <LoginScreen />;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-6">
          <span className="text-xl font-extrabold tracking-tight text-blue-700 dark:text-blue-400">🎱 Snooker Counter</span>
          <nav className="flex gap-1">
            {NAV_ITEMS.filter((item) => !item.ownerManagerOnly || isOwnerOrManager).map((item) => (
              <button
                key={item.key}
                onClick={() => setScreen(item.key)}
                className={`rounded-lg px-4 py-2 text-base font-semibold transition ${
                  screen === item.key
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <SyncStatusIndicator />
          <div className="text-right text-sm">
            <div className="font-bold">{session.user.fullName}</div>
            <div className="capitalize text-slate-500 dark:text-slate-400">{session.user.role}</div>
          </div>
          <button
            className="btn-secondary py-2 px-4 text-base"
            onClick={() => useAuthStore.getState().openPendingShiftClose()}
          >
            Log Out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto bg-slate-100 p-6 dark:bg-slate-900">
        {screen === "dashboard" && <MainDashboard onNavigateLedger={() => setScreen("ledger")} />}
        {screen === "ledger" && <CustomerLedgerScreen />}
        {screen === "reports" && <ReportsScreen />}
        {screen === "expense" && <ExpenseEntryScreen />}
        {screen === "admin" && isOwnerOrManager && <AdminSettingsScreen />}
      </main>

      {pendingShiftClose && <ShiftCloseScreen mode="logout" />}
    </div>
  );
}
