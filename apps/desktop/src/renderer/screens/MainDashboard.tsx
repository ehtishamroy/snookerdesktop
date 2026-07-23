import { useEffect, useState } from "react";
import { useTablesStore } from "../state/tablesStore";
import { TableTile } from "../components/TableTile";
import { IdleAlertBanner } from "../components/IdleAlertBanner";
import { TableDetailsScreen } from "./TableDetailsScreen";

export function MainDashboard({ onNavigateLedger }: { onNavigateLedger: () => void }) {
  const { tiles, summary, startPolling } = useTablesStore();
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);

  useEffect(() => startPolling(), [startPolling]);

  if (selectedTableId !== null) {
    return <TableDetailsScreen tableId={selectedTableId} onBack={() => setSelectedTableId(null)} />;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 grid grid-cols-4 gap-4">
        <SummaryCard label="Today's Revenue" value={`Rs. ${summary?.totalRevenueToday ?? 0}`} tone="blue" />
        <SummaryCard label="Pending Dues" value={`Rs. ${summary?.pendingDuesTotal ?? 0}`} tone="amber" onClick={onNavigateLedger} />
        <SummaryCard label="Occupied" value={`${summary?.occupiedCount ?? 0}`} tone="red" />
        <SummaryCard label="Vacant" value={`${summary?.vacantCount ?? 0}`} tone="green" />
      </div>

      <div className="mb-4">
        <IdleAlertBanner onOpenTable={(tableId) => setSelectedTableId(tableId)} />
      </div>

      <div className="grid grid-cols-3 gap-5">
        {tiles.map((tile) => (
          <TableTile key={tile.table.id} tile={tile} onClick={() => setSelectedTableId(tile.table.id)} />
        ))}
      </div>
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
