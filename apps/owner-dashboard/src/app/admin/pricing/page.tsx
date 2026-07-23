"use client";

import { useMemo, useState } from "react";
import { PageGuard } from "@/components/PageGuard";
import { EmptyState } from "@/components/EmptyState";
import { useActivePricingRules, useGameTypes, usePricingHistory } from "@/hooks/usePricing";
import { apiClient, ApiError } from "@/lib/apiClient";
import { formatDateTime, formatPKR } from "@/lib/format";
import type { TableType } from "@snooker/shared";
import { TABLE_TYPES } from "@snooker/shared";

export default function AdminPricingPage() {
  return (
    <PageGuard allow={["owner"]}>
      <AdminPricingContent />
    </PageGuard>
  );
}

function AdminPricingContent() {
  const { rules, isLoading, refresh } = useActivePricingRules();
  const { gameTypes } = useGameTypes();
  const [editing, setEditing] = useState<{ tableType: TableType; gameTypeId: number } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ tableType: TableType; gameTypeId: number } | null>(null);

  const ruleFor = (tableType: TableType, gameTypeId: number) =>
    rules.find((r) => r.tableType === tableType && r.gameTypeId === gameTypeId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Pricing</h1>
        <p className="page-subtitle">Owner-only. Editing a price starts a new version from now — it never rewrites history.</p>
      </div>

      <div className="card border-l-4 border-l-brand-500">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <strong>How price changes work:</strong> when you save a new price below, it takes effect immediately for
          any game started after that moment. Every game already played — and any game currently in progress — keeps
          the price that was active when it started. Nothing is rewritten retroactively. This is why every row below
          has a full version history rather than a single editable price.
        </p>
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ) : gameTypes.length === 0 ? (
        <EmptyState title="No game types found" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <th className="px-3 py-2">Game type</th>
                {TABLE_TYPES.map((tt) => (
                  <th key={tt} className="px-3 py-2 capitalize">
                    {tt.replace("_", " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gameTypes.map((gt) => (
                <tr key={gt.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                  <td className="px-3 py-2 font-medium">{gt.name}</td>
                  {TABLE_TYPES.map((tt) => {
                    const rule = ruleFor(tt, gt.id);
                    return (
                      <td key={tt} className="px-3 py-2">
                        {rule ? (
                          <div className="flex flex-col gap-1">
                            <div className="font-semibold">
                              {formatPKR(rule.price)} <span className="font-normal text-slate-400">/ {rule.durationMinutes}m</span>
                            </div>
                            <div className="flex gap-2 text-xs">
                              <button className="text-brand-600 hover:underline dark:text-brand-400" onClick={() => setEditing({ tableType: tt, gameTypeId: gt.id })}>
                                Change price
                              </button>
                              <button className="text-slate-400 hover:underline" onClick={() => setHistoryFor({ tableType: tt, gameTypeId: gt.id })}>
                                History
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button className="btn-secondary text-xs" onClick={() => setEditing({ tableType: tt, gameTypeId: gt.id })}>
                            Set price
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <EditPriceModal
          tableType={editing.tableType}
          gameTypeId={editing.gameTypeId}
          gameTypeName={gameTypes.find((g) => g.id === editing.gameTypeId)?.name ?? ""}
          currentRule={ruleFor(editing.tableType, editing.gameTypeId)}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}

      {historyFor ? (
        <HistoryModal
          tableType={historyFor.tableType}
          gameTypeId={historyFor.gameTypeId}
          gameTypeName={gameTypes.find((g) => g.id === historyFor.gameTypeId)?.name ?? ""}
          onClose={() => setHistoryFor(null)}
        />
      ) : null}
    </div>
  );
}

function EditPriceModal({
  tableType,
  gameTypeId,
  gameTypeName,
  currentRule,
  onClose,
  onSaved,
}: {
  tableType: TableType;
  gameTypeId: number;
  gameTypeName: string;
  currentRule?: { price: number; durationMinutes: number };
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [price, setPrice] = useState(currentRule ? String(currentRule.price) : "");
  const [duration, setDuration] = useState(currentRule ? String(currentRule.durationMinutes) : "25");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const priceNum = Number(price);
    const durationNum = Number(duration);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Enter a valid price.");
      return;
    }
    if (!Number.isFinite(durationNum) || durationNum <= 0) {
      setError("Enter a valid block duration.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.createPricingRule({ tableType, gameTypeId, price: priceNum, durationMinutes: durationNum });
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save price.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md">
        <h2 className="mb-1 text-base font-semibold">
          {gameTypeName} · {tableType.replace("_", " ")}
        </h2>
        <p className="mb-4 text-xs text-slate-400">
          This saves a brand-new price version effective right now. Games already in progress or already played keep
          the old price — nothing is rewritten.
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="label">New price (PKR)</label>
            <input className="input" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="label">Block duration (minutes)</label>
            <input className="input" type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          {error ? <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save new version"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({
  tableType,
  gameTypeId,
  gameTypeName,
  onClose,
}: {
  tableType: TableType;
  gameTypeId: number;
  gameTypeName: string;
  onClose: () => void;
}) {
  const { history, isLoading } = usePricingHistory(tableType, gameTypeId);
  const sorted = useMemo(
    () => [...history].sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()),
    [history]
  );

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            Price history — {gameTypeName} · {tableType.replace("_", " ")}
          </h2>
          <button className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            Close
          </button>
        </div>
        {isLoading ? (
          <div className="h-32 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : sorted.length === 0 ? (
          <EmptyState title="No price history yet" />
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {sorted.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                <div>
                  <div className="font-medium">
                    {formatPKR(r.price)} / {r.durationMinutes}m
                  </div>
                  <div className="text-xs text-slate-400">
                    {formatDateTime(r.effectiveFrom)} → {r.effectiveTo ? formatDateTime(r.effectiveTo) : "current"}
                  </div>
                </div>
                {!r.effectiveTo ? (
                  <span className="rounded-full bg-felt-100 px-2 py-0.5 text-xs font-medium text-felt-800 dark:bg-felt-900/40 dark:text-felt-300">
                    Active
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
