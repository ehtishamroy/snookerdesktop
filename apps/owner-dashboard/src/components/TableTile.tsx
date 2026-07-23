"use client";

import { useEffect, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { apiClient } from "@/lib/apiClient";
import type { TableWithStatus } from "@/lib/apiTypes";
import { formatPKR } from "@/lib/format";
import { CAN_MANAGE_TABLES } from "@/lib/roles";

function LiveTimer({ startTime }: { startTime: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedMs = Date.now() - new Date(startTime).getTime();
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const text = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;

  return <span className="font-mono text-lg font-semibold tabular-nums">{text}</span>;
}

export function TableTile({ table, onChanged }: { table: TableWithStatus; onChanged?: () => void | Promise<void> }) {
  const occupied = table.status === "occupied";
  const idle = table.activeGame?.isIdleAlert ?? false;
  const [isToggling, setIsToggling] = useState(false);

  async function toggleActive() {
    if (occupied) return; // never allow deactivating a table mid-game
    setIsToggling(true);
    try {
      await apiClient.updateTable(table.id, { isActive: !table.isActive });
      await onChanged?.();
    } finally {
      setIsToggling(false);
    }
  }

  return (
    <div
      className={`card relative flex flex-col gap-2 overflow-hidden border-l-4 ${
        idle
          ? "border-l-rose-500"
          : occupied
            ? "border-l-brand-500"
            : "border-l-felt-500"
      } ${!table.isActive ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">{table.label}</div>
          <div className="text-xs capitalize text-slate-500 dark:text-slate-400">
            {table.tableType.replace("_", " ")}
            {!table.isActive ? " · inactive" : ""}
          </div>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            occupied
              ? "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300"
              : "bg-felt-100 text-felt-800 dark:bg-felt-900/40 dark:text-felt-300"
          }`}
        >
          {occupied ? "Occupied" : "Vacant"}
        </span>
      </div>

      {occupied && table.activeGame ? (
        <div className="flex flex-col gap-1">
          <div className="truncate text-sm text-slate-700 dark:text-slate-200">{table.activeGame.loserCustomerName}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{table.activeGame.gameTypeName}</div>
          <LiveTimer startTime={table.activeGame.startTime} />
          {idle ? (
            <div className="rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
              Running well past expected time — check if &quot;End Game&quot; was forgotten.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-slate-400 dark:text-slate-500">No active game</div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
        <span className="text-slate-500 dark:text-slate-400">Today</span>
        <span className="font-semibold text-slate-800 dark:text-slate-100">{formatPKR(table.todayEarnings)}</span>
      </div>

      {/* Only per-table admin action: active/inactive (no maintenance-mode state, decision #8). */}
      <RoleGate allow={CAN_MANAGE_TABLES}>
        <button
          onClick={toggleActive}
          disabled={isToggling || occupied}
          title={occupied ? "Can't deactivate a table with an active game" : undefined}
          className="text-left text-[11px] font-medium text-slate-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-brand-400"
        >
          {isToggling ? "Saving…" : table.isActive ? "Mark inactive" : "Mark active"}
        </button>
      </RoleGate>
    </div>
  );
}
