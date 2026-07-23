import { useEffect, useMemo, useState } from "react";
import { computeBilling, minutesElapsed } from "@snooker/shared";
import type { PaymentMethod, PaymentStatus } from "@snooker/shared";
import { api } from "../api";
import type { GameTypeEntity, TableTileView } from "../api";
import { Modal } from "../components/Modal";
import { PlayerNameField, resolveLoserCustomerId, type PlayerNameFieldState } from "../components/PlayerNameField";
import { TimeInput12h } from "../components/TimeInput12h";
import { formatDateTime12h } from "../lib/time";
import { useAuthStore } from "../state/authStore";
import { useTablesStore } from "../state/tablesStore";

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "easypaisa", "jazzcash", "card"];
const PAYMENT_STATUSES: PaymentStatus[] = ["paid", "pending", "loan", "collateral", "tricked"];

export function RegisterPanel({ tile, onClose }: { tile: TableTileView; onClose: () => void }) {
  const session = useAuthStore((s) => s.session)!;
  const refreshTiles = useTablesStore((s) => s.refresh);

  const [gameTypes, setGameTypes] = useState<GameTypeEntity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.gameTypes.list(tile.table.tableType).then(setGameTypes);
  }, [tile.table.tableType]);

  if (tile.status === "occupied" && tile.currentGame) {
    return (
      <EndGameForm
        tile={tile}
        currentUserId={session.user.id}
        shiftId={session.shift.id}
        onClose={onClose}
        onDone={async () => {
          await refreshTiles();
          onClose();
        }}
      />
    );
  }

  return (
    <StartGameForm
      tile={tile}
      gameTypes={gameTypes}
      currentUserId={session.user.id}
      shiftId={session.shift.id}
      error={error}
      setError={setError}
      busy={busy}
      setBusy={setBusy}
      onClose={onClose}
      onDone={async () => {
        await refreshTiles();
        onClose();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Start Game — table + game type + start time only. Who's playing is added
// later, mid-game or at checkout (see TableDetailsScreen and EndGameForm).
// ---------------------------------------------------------------------------

function StartGameForm({
  tile,
  gameTypes,
  currentUserId,
  shiftId,
  error,
  setError,
  busy,
  setBusy,
  onClose,
  onDone,
}: {
  tile: TableTileView;
  gameTypes: GameTypeEntity[];
  currentUserId: number;
  shiftId: number;
  error: string | null;
  setError: (e: string | null) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [gameTypeId, setGameTypeId] = useState<number | null>(null);
  const [startTime, setStartTime] = useState<Date>(new Date());

  useEffect(() => {
    if (!gameTypeId && gameTypes.length > 0) setGameTypeId(gameTypes[0]!.id);
  }, [gameTypes, gameTypeId]);

  async function handleStart() {
    setError(null);
    if (!gameTypeId) {
      setError("Choose a game type");
      return;
    }
    setBusy(true);
    try {
      await api.games.start({
        tableId: tile.table.id,
        gameTypeId,
        startTime: startTime.toISOString(),
        createdByUserId: currentUserId,
        shiftId,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start game");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Table ${tile.table.tableNumber} — Start Game`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="field-label">Game Type</label>
          <select className="field-input" value={gameTypeId ?? ""} onChange={(e) => setGameTypeId(Number(e.target.value))}>
            {gameTypes.map((gt) => (
              <option key={gt.id} value={gt.id}>
                {gt.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label">Start Time</label>
          <TimeInput12h value={startTime} onChange={setStartTime} />
        </div>

        <div className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          You can add the player&rsquo;s name any time while the game is running, or when you end it.
        </div>

        {error && <div className="rounded-lg bg-red-100 px-4 py-2 text-red-800 dark:bg-red-900/40 dark:text-red-300">{error}</div>}

        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleStart} disabled={busy}>
            {busy ? "Starting…" : "Start Game"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// End Game & Checkout
// ---------------------------------------------------------------------------

function EndGameForm({
  tile,
  currentUserId,
  shiftId,
  onClose,
  onDone,
}: {
  tile: TableTileView;
  currentUserId: number;
  shiftId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const game = tile.currentGame!;
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [priceOverride, setPriceOverride] = useState<number | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [collateralDescription, setCollateralDescription] = useState("");
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [discountReason, setDiscountReason] = useState("");
  const [playerState, setPlayerState] = useState<PlayerNameFieldState>({
    loser: game.loserCustomerId && game.loserName ? { id: game.loserCustomerId, label: game.loserName } : null,
    isNishani: false,
    nishaniText: "",
    winner: game.winnerCustomerId && game.winnerName ? { id: game.winnerCustomerId, label: game.winnerName } : null,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (endTime) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endTime]);

  const effectiveEndDate = endTime ?? new Date(nowTick);
  const effectiveEndIso = effectiveEndDate.toISOString();
  // Uses the block price/duration already resolved by the server at this
  // round's START time (decision #2), never "today's" active price — those
  // can differ if the owner changed pricing mid-round.
  const billingPreview = useMemo(() => {
    const durationActual = minutesElapsed(new Date(game.startTime), new Date(effectiveEndIso));
    return computeBilling(
      { blockPrice: game.blockPrice, blockDurationMinutes: game.blockDurationMinutes },
      Math.max(0, durationActual)
    );
  }, [game.blockPrice, game.blockDurationMinutes, game.startTime, effectiveEndIso]);

  const priceOriginal = priceOverride ?? billingPreview?.priceOriginal ?? 0;
  const discountAmount =
    discountMode === "amount" ? Number(discountValue) || 0 : Math.round((priceOriginal * (Number(discountValue) || 0)) / 100);
  const priceFinal = Math.max(0, priceOriginal - discountAmount);

  async function handleEndGame() {
    setError(null);
    if (paymentStatus === "paid" && !paymentMethod) {
      setError("Choose a payment method");
      return;
    }
    if (paymentStatus === "collateral" && !collateralDescription.trim()) {
      setError("Describe the item being held as collateral");
      return;
    }
    setBusy(true);
    try {
      const loserCustomerId = await resolveLoserCustomerId(playerState);
      if (!loserCustomerId) {
        setError("Add a player name (or a temporary/nishani description) before ending the game");
        setBusy(false);
        return;
      }
      await api.games.end({
        gameId: game.gameId,
        endTime: effectiveEndIso,
        priceOverride: priceOverride ?? undefined,
        paymentStatus,
        discountAmount: discountMode === "amount" ? Number(discountValue) || 0 : undefined,
        discountPercent: discountMode === "percent" ? Number(discountValue) || 0 : undefined,
        discountReason: discountReason.trim() || undefined,
        discountByUserId: currentUserId,
        paymentMethod: paymentStatus === "paid" ? paymentMethod : undefined,
        collateralDescription: paymentStatus === "collateral" ? collateralDescription.trim() : undefined,
        loserCustomerId,
        winnerCustomerId: playerState.winner?.id ?? null,
        performedByUserId: currentUserId,
        shiftId,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end game");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Table ${tile.table.tableNumber} — ${game.gameTypeName}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-100 px-4 py-3 text-sm dark:bg-slate-700">
          <span className="font-semibold">Started:</span> {formatDateTime12h(game.startTime)}
        </div>

        <PlayerNameField state={playerState} onChange={setPlayerState} autoFocus={!game.loserName} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">End Time</label>
            <TimeInput12h value={effectiveEndDate} onChange={setEndTime} />
            {!endTime && (
              <button
                type="button"
                className="btn-secondary mt-2 w-full py-2 text-base"
                onClick={() => setEndTime(new Date())}
              >
                End Game Now
              </button>
            )}
          </div>
          <div>
            <label className="field-label">Price (editable)</label>
            <input
              type="number"
              className="field-input"
              value={priceOverride ?? billingPreview?.priceOriginal ?? 0}
              onChange={(e) => setPriceOverride(Number(e.target.value))}
            />
            {billingPreview && billingPreview.overtimeMinutes > 0 && (
              <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Includes {billingPreview.overtimeMinutes} min overtime (Rs. {billingPreview.overtimeAmount})
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="field-label">Payment Status</label>
          <div className="grid grid-cols-5 gap-2">
            {PAYMENT_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setPaymentStatus(status)}
                className={`rounded-lg px-2 py-3 text-sm font-bold capitalize ${
                  paymentStatus === status ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-100"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {paymentStatus === "collateral" && (
          <div>
            <label className="field-label">Collateral Item Description</label>
            <input
              className="field-input"
              placeholder="e.g. black Samsung phone"
              value={collateralDescription}
              onChange={(e) => setCollateralDescription(e.target.value)}
            />
          </div>
        )}

        {paymentStatus === "paid" && (
          <div>
            <label className="field-label">Payment Method</label>
            <div className="grid grid-cols-4 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`rounded-lg px-2 py-3 text-sm font-bold capitalize ${
                    paymentMethod === m ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-100"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">Discount</label>
            <div className="flex gap-2">
              <select className="field-input w-24" value={discountMode} onChange={(e) => setDiscountMode(e.target.value as any)}>
                <option value="amount">Rs.</option>
                <option value="percent">%</option>
              </select>
              <input
                type="number"
                className="field-input"
                placeholder="0"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="field-label">Discount Reason (optional)</label>
            <input className="field-input" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg bg-blue-50 px-4 py-3 text-lg font-bold dark:bg-blue-950/30">
          Final amount: Rs. {priceFinal}
          {discountAmount > 0 && <span className="ml-2 text-sm font-normal text-slate-500">(Rs. {discountAmount} discount applied)</span>}
        </div>

        {error && <div className="rounded-lg bg-red-100 px-4 py-2 text-red-800 dark:bg-red-900/40 dark:text-red-300">{error}</div>}

        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-success" onClick={handleEndGame} disabled={busy}>
            {busy ? "Saving…" : "End Game & Checkout"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
