import { useEffect, useState } from "react";
import type { TableTileView } from "../api";

function useSecondTicker(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

function formatElapsed(startTimeIso: string): string {
  const elapsedMs = Date.now() - new Date(startTimeIso).getTime();
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function TableTile({ tile, onClick }: { tile: TableTileView; onClick: () => void }) {
  useSecondTicker(); // forces a re-render every second so the running timer ticks live

  const { table, status, currentGame, todayEarnings } = tile;
  const isPrivateRoom = table.tableType === "private_room";

  if (!table.isActive) {
    return (
      <div className="card flex h-48 flex-col items-center justify-center gap-1 border-dashed bg-slate-100 text-slate-400 dark:bg-slate-800/60">
        <span className="text-tile">{table.tableNumber}</span>
        <span className="text-sm font-semibold uppercase tracking-wide">Inactive</span>
      </div>
    );
  }

  const isIdle = !!currentGame?.isIdleAlert;
  const baseColor =
    status === "occupied"
      ? isIdle
        ? "bg-red-800 ring-4 ring-amber-400 animate-pulse"
        : "bg-occupied"
      : "bg-vacant";

  return (
    <button
      onClick={onClick}
      className={`card flex h-48 flex-col justify-between p-4 text-left text-white shadow-md transition hover:brightness-110 active:scale-[0.98] ${baseColor}`}
    >
      <div className="flex items-start justify-between">
        <span className="text-tile">{table.tableNumber}</span>
        {isPrivateRoom && (
          <span className="rounded-full bg-black/25 px-3 py-1 text-xs font-bold uppercase tracking-wide">Private Room</span>
        )}
      </div>

      {status === "occupied" && currentGame ? (
        <div>
          <div className="text-sm font-semibold opacity-90">{currentGame.gameTypeName}</div>
          <div className="truncate text-base font-bold">
            {currentGame.loserName}
            {currentGame.winnerName ? ` vs ${currentGame.winnerName}` : ""}
          </div>
          <div className="mt-1 font-mono text-2xl font-extrabold tabular-nums">{formatElapsed(currentGame.startTime)}</div>
          {isIdle && <div className="mt-1 text-xs font-bold uppercase tracking-wide text-amber-300">⚠ Forgot to end game?</div>}
        </div>
      ) : (
        <div className="text-lg font-bold uppercase tracking-wide opacity-90">Vacant</div>
      )}

      <div className="text-sm font-semibold opacity-90">Today: Rs. {todayEarnings}</div>
    </button>
  );
}
