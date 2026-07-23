"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PageGuard } from "@/components/PageGuard";
import { RangePicker } from "@/components/RangePicker";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useUsers } from "@/hooks/useUsers";
import type { AuditLogRow } from "@/lib/apiTypes";
import { presetRange, type RangePreset } from "@/lib/dateRanges";
import { exportCsv } from "@/lib/exportCsv";
import { formatDateTime } from "@/lib/format";
import { AUDIT_ACTIONS } from "@snooker/shared";

const ENTITY_TYPES = ["games", "payments", "customers", "collateral_items", "pricing_rules", "users", "shifts"];

export default function HistoryPage() {
  return (
    <PageGuard allow={["owner", "manager"]}>
      <HistoryPageContent />
    </PageGuard>
  );
}

function HistoryPageContent() {
  const [preset, setPreset] = useState<RangePreset>("month");
  const [entityType, setEntityType] = useState<string>("");
  const [performedBy, setPerformedBy] = useState<number | "">("");
  const [actionFilter, setActionFilter] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const range = presetRange(preset);

  const { entries, isLoading } = useAuditLog({
    entityType: entityType || undefined,
    performedBy: performedBy === "" ? undefined : performedBy,
    from: range.from,
    to: range.to,
  });
  const { users } = useUsers();

  const filtered = useMemo(
    () => (actionFilter ? entries.filter((e) => e.action === actionFilter) : entries),
    [entries, actionFilter]
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Reversal &amp; edit history</h1>
        <p className="page-subtitle">
          Every corrected or reversed entry, with who/when/why (spec §7). Managers see the full log, same as owners —
          see README for the &quot;partial&quot; interpretation.
        </p>
      </div>

      <div className="card flex flex-wrap items-center gap-3">
        <RangePicker value={preset} onChange={setPreset} />
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="input !w-auto py-1.5 text-xs">
          <option value="">All entity types</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="input !w-auto py-1.5 text-xs">
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={performedBy}
          onChange={(e) => setPerformedBy(e.target.value === "" ? "" : Number(e.target.value))}
          className="input !w-auto py-1.5 text-xs"
        >
          <option value="">All staff</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </select>
        <button
          className="btn-secondary ml-auto text-xs"
          onClick={() =>
            exportCsv(
              "/reports/audit-log",
              { entityType: entityType || undefined, performedBy: performedBy === "" ? undefined : performedBy, from: range.from, to: range.to },
              "audit-log.csv"
            )
          }
        >
          Export CSV
        </button>
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ) : filtered.length === 0 ? (
        <EmptyState title="No audit entries match these filters" />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((entry) => (
            <AuditRow key={entry.id} entry={entry} expanded={expandedId === entry.id} onToggle={() => setExpandedId((id) => (id === entry.id ? null : entry.id))} />
          ))}
        </div>
      )}
    </div>
  );
}

function AuditRow({ entry, expanded, onToggle }: { entry: AuditLogRow; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="card">
      <button onClick={onToggle} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <div className="flex items-center gap-3">
          <ActionBadge action={entry.action} />
          <div>
            <div className="text-sm font-medium">
              {entry.entityType} #{entry.entityId}
              {entry.entityLabel ? ` — ${entry.entityLabel}` : ""}
            </div>
            <div className="text-xs text-slate-400">
              {entry.performedByName} · {formatDateTime(entry.performedAt)}
            </div>
          </div>
        </div>
        <span className="text-xs text-slate-400">{expanded ? "Hide details" : "Show before/after"}</span>
      </button>
      {expanded ? (
        <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 dark:border-slate-800 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-400">Before</div>
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-950">
              {entry.beforeValue ? JSON.stringify(entry.beforeValue, null, 2) : "—"}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-400">After</div>
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-950">
              {entry.afterValue ? JSON.stringify(entry.afterValue, null, 2) : "—"}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ACTION_STYLES: Record<string, string> = {
  create: "bg-felt-100 text-felt-800 dark:bg-felt-900/40 dark:text-felt-300",
  update: "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300",
  reverse: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  merge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  return_collateral: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  shift_open: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  shift_close: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

function ActionBadge({ action }: { action: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLES[action] ?? "bg-slate-100 text-slate-700"}`}>
      {action}
    </span>
  );
}
