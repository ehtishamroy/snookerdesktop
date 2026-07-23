import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { CurrentGameView, TableHistoryView } from "../api";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { PlayerNameField, resolveLoserCustomerId, type PlayerNameFieldState } from "../components/PlayerNameField";
import { formatDateTime12h, formatTime12h } from "../lib/time";
import { useAuthStore } from "../state/authStore";
import { useTablesStore } from "../state/tablesStore";
import { RegisterPanel } from "./RegisterPanel";

function useSecondTicker(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
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

/**
 * The "register/notebook" page for a single table — how many rounds it's
 * played and what's live right now, replacing the old behavior of jumping
 * straight into a Start/End Game popup the instant a table is clicked.
 */
export function TableDetailsScreen({ tableId, onBack }: { tableId: number; onBack: () => void }) {
  const { tiles, refresh } = useTablesStore();
  const tile = tiles.find((t) => t.table.id === tableId);

  const [history, setHistory] = useState<TableHistoryView | null>(null);
  const [showRegisterPanel, setShowRegisterPanel] = useState(false);
  const [showSetName, setShowSetName] = useState(false);

  const loadHistory = useCallback(async () => {
    const h = await api.tables.getHistory(tableId);
    setHistory(h);
  }, [tableId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useSecondTicker(); // keeps the live counter ticking every second

  if (!tile) {
    return (
      <div className="mx-auto max-w-4xl">
        <button className="btn-secondary mb-4" onClick={onBack}>
          ← Back to Tables
        </button>
        <div className="card p-6">Table not found.</div>
      </div>
    );
  }

  const { table, status, currentGame, todayEarnings } = tile;

  async function afterAction() {
    await Promise.all([refresh(), loadHistory()]);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <button className="btn-secondary mb-4" onClick={onBack}>
        ← Back to Tables
      </button>

      <div className="card mb-6 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-tile">Table {table.tableNumber}</div>
            <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">{table.label}</div>
          </div>
          <Badge tone={status === "occupied" ? "red" : "green"}>{status === "occupied" ? "Occupied" : "Vacant"}</Badge>
        </div>

        {status === "occupied" && currentGame ? (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <div className="text-sm font-semibold opacity-75">{currentGame.gameTypeName}</div>
                <div className="text-xl font-bold">
                  {currentGame.loserName ?? <span className="italic text-amber-600 dark:text-amber-400">No name set yet</span>}
                  {currentGame.winnerName ? ` vs ${currentGame.winnerName}` : ""}
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  Started {formatDateTime12h(currentGame.startTime)}
                </div>
              </div>
              <div className="font-mono text-4xl font-extrabold tabular-nums text-blue-700 dark:text-blue-400">
                {formatElapsed(currentGame.startTime)}
              </div>
            </div>

            <div className="flex gap-3">
              <button className="btn-secondary" onClick={() => setShowSetName(true)}>
                {currentGame.loserName ? "Change Player Name" : "Set Player Name"}
              </button>
              <button className="btn-success" onClick={() => setShowRegisterPanel(true)}>
                End Game & Checkout
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-lg font-bold uppercase tracking-wide text-slate-400">Vacant</div>
            <button className="btn-primary" onClick={() => setShowRegisterPanel(true)}>
              Start Game
            </button>
          </div>
        )}

        <div className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Today: Rs. {todayEarnings}</div>
      </div>

      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Game History</h2>
          {history && (
            <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              {history.totalGamesToday} today · {history.totalGamesAllTime} all-time
            </div>
          )}
        </div>
        <div className="max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-600 dark:text-slate-400">
                <th className="py-2 pr-2">Time</th>
                <th className="py-2 pr-2">Type</th>
                <th className="py-2 pr-2">Player</th>
                <th className="py-2 pr-2">Duration</th>
                <th className="py-2 pr-2">Price</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {history?.items.map((g) => (
                <tr
                  key={g.gameId}
                  className={`border-b border-slate-100 dark:border-slate-700 ${g.reversed ? "text-slate-400 line-through" : ""}`}
                >
                  <td className="py-2 pr-2">{formatTime12h(g.startTime)}</td>
                  <td className="py-2 pr-2">{g.gameTypeName}</td>
                  <td className="py-2 pr-2">
                    {g.loserName ?? "—"}
                    {g.winnerName ? ` vs ${g.winnerName}` : ""}
                  </td>
                  <td className="py-2 pr-2">{g.durationBilledMinutes != null ? `${g.durationBilledMinutes} min` : "In progress"}</td>
                  <td className="py-2 pr-2">Rs. {g.priceFinal}</td>
                  <td className="py-2 capitalize">{g.paymentStatus}</td>
                </tr>
              ))}
              {history && history.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    No games played on this table yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showRegisterPanel && (
        <RegisterPanel
          tile={tile}
          onClose={async () => {
            setShowRegisterPanel(false);
            await afterAction();
          }}
        />
      )}

      {showSetName && currentGame && (
        <SetPlayerNameModal
          game={currentGame}
          onClose={() => setShowSetName(false)}
          onSaved={async () => {
            setShowSetName(false);
            await afterAction();
          }}
        />
      )}
    </div>
  );
}

function SetPlayerNameModal({
  game,
  onClose,
  onSaved,
}: {
  game: CurrentGameView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const session = useAuthStore((s) => s.session)!;
  const [state, setState] = useState<PlayerNameFieldState>({
    loser: game.loserCustomerId && game.loserName ? { id: game.loserCustomerId, label: game.loserName } : null,
    isNishani: false,
    nishaniText: "",
    winner: game.winnerCustomerId && game.winnerName ? { id: game.winnerCustomerId, label: game.winnerName } : null,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setError(null);
    setBusy(true);
    try {
      const loserCustomerId = await resolveLoserCustomerId(state);
      if (!loserCustomerId) {
        setError("Enter a name or a temporary/nishani description");
        setBusy(false);
        return;
      }
      await api.games.update({
        gameId: game.gameId,
        patch: { loserCustomerId, winnerCustomerId: state.winner?.id ?? null },
        performedByUserId: session.user.id,
        reason: "Set player identity during round",
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Set Player Name" onClose={onClose}>
      <div className="space-y-4">
        <PlayerNameField state={state} onChange={setState} autoFocus />
        {error && <div className="rounded-lg bg-red-100 px-4 py-2 text-red-800 dark:bg-red-900/40 dark:text-red-300">{error}</div>}
        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
