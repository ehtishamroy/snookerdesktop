import { useEffect, useState } from "react";
import { useTablesStore } from "../state/tablesStore";
import { TableTile } from "../components/TableTile";
import { IdleAlertBanner } from "../components/IdleAlertBanner";
import { RegisterPanel } from "./RegisterPanel";
import type { TableTileView } from "../api";

export function MainDashboard({ onNavigateLedger }: { onNavigateLedger: () => void }) {
  const { tiles, summary, startPolling } = useTablesStore();
  const [openTile, setOpenTile] = useState<TableTileView | null>(null);

  useEffect(() => startPolling(), [startPolling]);

  // Keep the open Register Panel's tile data fresh as the underlying poll refreshes.
  useEffect(() => {
    if (!openTile) return;
    const fresh = tiles.find((t) => t.table.id === openTile.table.id);
    if (fresh) setOpenTile(fresh);
  }, [tiles]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 grid grid-cols-4 gap-4">
        <SummaryCard label="Today's Revenue" value={`Rs. ${summary?.totalRevenueToday ?? 0}`} tone="blue" />
        <SummaryCard label="Pending Dues" value={`Rs. ${summary?.pendingDuesTotal ?? 0}`} tone="amber" onClick={onNavigateLedger} />
        <SummaryCard label="Occupied" value={`${summary?.occupiedCount ?? 0}`} tone="red" />
        <SummaryCard label="Vacant" value={`${summary?.vacantCount ?? 0}`} tone="green" />
      </div>

      <div className="mb-4">
        <IdleAlertBanner onOpenTable={(tableId) => setOpenTile(tiles.find((t) => t.table.id === tableId) ?? null)} />
      </div>

      <div className="grid grid-cols-3 gap-5">
        {tiles.map((tile) => (
          <TableTile key={tile.table.id} tile={tile} onClick={() => setOpenTile(tile)} />
        ))}
      </div>

      {openTile && <RegisterPanel tile={openTile} onClose={() => setOpenTile(null)} />}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone: "blue" | "amber" | "red" | "green";
  onClick?: () => void;
}) {
  const toneClasses: Record<string, string> = {
    blue: "text-blue-700 dark:text-blue-400",
    amber: "text-amber-700 dark:text-amber-400",
    red: "text-red-700 dark:text-red-400",
    green: "text-green-700 dark:text-green-400",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={`card p-4 text-left ${onClick ? "hover:bg-slate-50 dark:hover:bg-slate-700" : ""}`}>
      <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-2xl font-extrabold ${toneClasses[tone]}`}>{value}</div>
    </Comp>
  );
}
