import { useEffect } from "react";
import { useSyncStatusStore } from "../state/syncStatusStore";

const DOT_CLASS: Record<string, string> = {
  synced: "bg-green-500",
  syncing: "bg-blue-500 animate-pulse",
  offline: "bg-slate-400",
  error: "bg-red-500",
};

const LABEL: Record<string, string> = {
  synced: "Synced",
  syncing: "Syncing…",
  offline: "Offline",
  error: "Sync error",
};

/** Spec §3.3.5 — "Synced / Syncing / Offline — X records pending" indicator, always visible. */
export function SyncStatusIndicator() {
  const { status, init } = useSyncStatusStore();

  useEffect(() => {
    const unsubscribe = init();
    return unsubscribe;
  }, [init]);

  return (
    <div className="flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-semibold shadow-sm dark:bg-slate-800/80" title={status.lastError ?? undefined}>
      <span className={`h-2.5 w-2.5 rounded-full ${DOT_CLASS[status.state]}`} />
      <span>{LABEL[status.state]}</span>
      {status.pendingCount > 0 && (
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700">{status.pendingCount} pending</span>
      )}
    </div>
  );
}
