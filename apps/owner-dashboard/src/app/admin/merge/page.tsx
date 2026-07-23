"use client";

import { useMemo, useState } from "react";
import { PageGuard } from "@/components/PageGuard";
import { EmptyState } from "@/components/EmptyState";
import { useCustomerLedger, useLoanLedger } from "@/hooks/useLedger";
import { useCustomerSearch, useMergeCustomers } from "@/hooks/useCustomers";
import type { LoanLedgerEntry } from "@/lib/apiTypes";
import { formatDateTime, formatPKR } from "@/lib/format";

type Tab = "identify" | "merge";

export default function AdminMergePage() {
  return (
    <PageGuard allow={["owner", "manager"]}>
      <AdminMergeContent />
    </PageGuard>
  );
}

function AdminMergeContent() {
  const [tab, setTab] = useState<Tab>("identify");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Customer merge</h1>
        <p className="page-subtitle">
          Nishani (temporary) records are never meant to stay around — they exist only to track a running balance
          until you learn who the customer really is. Once identified below and merged, the temporary record
          disappears into the real profile. Anything never merged is automatically cleaned up once fully paid (see
          README).
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900 w-fit">
        <TabButton active={tab === "identify"} onClick={() => setTab("identify")}>
          Identify a nishani (primary)
        </TabButton>
        <TabButton active={tab === "merge"} onClick={() => setTab("merge")}>
          Merge two customer records
        </TabButton>
      </div>

      {tab === "identify" ? <IdentifyNishaniFlow /> : <MergeDuplicatesFlow />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function IdentifyNishaniFlow() {
  const { entries, isLoading } = useLoanLedger();
  const nishaniEntries = useMemo(() => entries.filter((e) => e.isTemporary), [entries]);
  const [selectedNishani, setSelectedNishani] = useState<LoanLedgerEntry | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        These are temporary entries (e.g. &quot;guy in red shirt&quot;) that still owe money and haven&apos;t been
        matched to a real customer yet. Pick one, then search for who they actually are.
      </p>
      {isLoading ? (
        <div className="h-32 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ) : nishaniEntries.length === 0 ? (
        <EmptyState title="No unmerged nishani with a balance right now" hint="Fully settled nishani records are purged automatically — there's nothing to clean up." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {nishaniEntries.map((n) => (
            <button
              key={n.customerId}
              onClick={() => setSelectedNishani(n)}
              className={`card text-left transition-colors ${
                selectedNishani?.customerId === n.customerId ? "ring-2 ring-brand-500" : "hover:border-brand-300"
              }`}
            >
              <div className="text-sm font-semibold">{n.displayName}</div>
              {n.nishaniDescription ? <div className="text-xs text-slate-400">{n.nishaniDescription}</div> : null}
              <div className="mt-1 flex justify-between text-xs">
                <span className="text-slate-400">{n.unsettledCount} unsettled round(s)</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">{formatPKR(n.totalOwed)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedNishani ? (
        <IdentifyTargetPicker nishani={selectedNishani} onDone={() => setSelectedNishani(null)} />
      ) : null}
    </div>
  );
}

function IdentifyTargetPicker({ nishani, onDone }: { nishani: LoanLedgerEntry; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const { customers } = useCustomerSearch(search);
  const [targetId, setTargetId] = useState<number | null>(null);
  const { ledger: nishaniLedger } = useCustomerLedger(nishani.customerId);
  const { merge, isMerging, error } = useMergeCustomers();
  const [done, setDone] = useState(false);

  async function handleConfirm() {
    if (!targetId) return;
    const ok = await merge(nishani.customerId, targetId);
    if (ok) setDone(true);
  }

  if (done) {
    return (
      <div className="card border-l-4 border-l-felt-500">
        <p className="text-sm font-medium text-felt-700 dark:text-felt-400">
          Merged. &quot;{nishani.displayName}&quot;&apos;s full history now lives under the real customer profile — the
          temporary entry no longer appears anywhere.
        </p>
        <button className="btn-secondary mt-3 text-xs" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-3">
      <h3 className="text-sm font-semibold">
        Who is &quot;{nishani.displayName}&quot; actually? <span className="font-normal text-slate-400">(search real customers)</span>
      </h3>
      <input
        className="input"
        placeholder="Search by name or phone…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search.trim().length >= 2 ? (
        <div className="flex flex-col gap-1">
          {customers.length === 0 ? (
            <div className="text-xs text-slate-400">No matching customers. Create the real profile first from the counter app, then come back here.</div>
          ) : (
            customers.map((c) => (
              <button
                key={c.id}
                onClick={() => setTargetId(c.id)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                  targetId === c.id ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20" : "border-slate-200 dark:border-slate-800"
                }`}
              >
                <span>{c.displayName}</span>
                {c.phone ? <span className="text-xs text-slate-400">{c.phone}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}

      {targetId && nishaniLedger ? (
        <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-950">
          <div className="mb-1 font-semibold text-slate-600 dark:text-slate-300">Preview — what will move</div>
          <div>{nishaniLedger.unsettledGames.length} unsettled round(s), totalling {formatPKR(nishaniLedger.totalOwed)}</div>
          <div className="text-slate-400">
            Span: {formatDateTime(nishaniLedger.spanStart)} → {formatDateTime(nishaniLedger.spanEnd)}
          </div>
          <div className="mt-1 text-slate-400">Full game/payment history will be re-pointed to the selected customer; the temporary record is then removed.</div>
        </div>
      ) : null}

      {error ? <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}

      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!targetId || isMerging} onClick={handleConfirm}>
          {isMerging ? "Merging…" : "Confirm — this is the same person"}
        </button>
      </div>
    </div>
  );
}

function MergeDuplicatesFlow() {
  const [searchA, setSearchA] = useState("");
  const [searchB, setSearchB] = useState("");
  const { customers: resultsA } = useCustomerSearch(searchA);
  const { customers: resultsB } = useCustomerSearch(searchB);
  const [fromId, setFromId] = useState<number | null>(null);
  const [intoId, setIntoId] = useState<number | null>(null);
  const { ledger: fromLedger } = useCustomerLedger(fromId);
  const { merge, isMerging, error } = useMergeCustomers();
  const [done, setDone] = useState(false);

  async function handleConfirm() {
    if (!fromId || !intoId) return;
    const ok = await merge(fromId, intoId);
    if (ok) setDone(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Use this when the same real person has two informal-name profiles (e.g. &quot;Ali&quot; vs &quot;Ali
        Bhai&quot;) — not for nishani, which have their own dedicated flow above.
      </p>

      {done ? (
        <div className="card border-l-4 border-l-felt-500">
          <p className="text-sm font-medium text-felt-700 dark:text-felt-400">Merged successfully. Full history preserved under the target profile.</p>
          <button
            className="btn-secondary mt-3 text-xs"
            onClick={() => {
              setDone(false);
              setFromId(null);
              setIntoId(null);
            }}
          >
            Merge another pair
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <CustomerPicker
            label="Duplicate to merge away"
            search={searchA}
            onSearch={setSearchA}
            results={resultsA}
            selectedId={fromId}
            onSelect={setFromId}
          />
          <CustomerPicker
            label="Keep this profile (target)"
            search={searchB}
            onSearch={setSearchB}
            results={resultsB}
            selectedId={intoId}
            onSelect={setIntoId}
          />
        </div>
      )}

      {!done && fromId && intoId && fromId === intoId ? (
        <div className="text-sm text-rose-600 dark:text-rose-400">Pick two different customers.</div>
      ) : null}

      {!done && fromId && intoId && fromId !== intoId && fromLedger ? (
        <div className="card text-xs">
          <div className="mb-1 font-semibold text-slate-600 dark:text-slate-300">Preview — what will move</div>
          <div>{fromLedger.unsettledGames.length} unsettled round(s), totalling {formatPKR(fromLedger.totalOwed)}, plus full paid history.</div>
        </div>
      ) : null}

      {error ? <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}

      {!done ? (
        <div className="flex justify-end">
          <button className="btn-primary" disabled={!fromId || !intoId || fromId === intoId || isMerging} onClick={handleConfirm}>
            {isMerging ? "Merging…" : "Confirm merge"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CustomerPicker({
  label,
  search,
  onSearch,
  results,
  selectedId,
  onSelect,
}: {
  label: string;
  search: string;
  onSearch: (v: string) => void;
  results: { id: number; displayName: string; phone: string | null }[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="card flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase text-slate-400">{label}</div>
      <input className="input" placeholder="Search by name or phone…" value={search} onChange={(e) => onSearch(e.target.value)} />
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {results.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
              selectedId === c.id ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20" : "border-slate-200 dark:border-slate-800"
            }`}
          >
            <span>{c.displayName}</span>
            {c.phone ? <span className="text-xs text-slate-400">{c.phone}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
