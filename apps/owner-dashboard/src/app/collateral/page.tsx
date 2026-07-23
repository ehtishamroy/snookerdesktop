"use client";

import { useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { PageGuard } from "@/components/PageGuard";
import { RoleGate } from "@/components/RoleGate";
import { StatCard } from "@/components/StatCard";
import { useHeldCollateral } from "@/hooks/useCollateral";
import { apiClient } from "@/lib/apiClient";
import { CAN_RETURN_COLLATERAL } from "@/lib/roles";
import type { CollateralItemRow } from "@/lib/apiTypes";
import { formatDateTime } from "@/lib/format";

export default function CollateralPage() {
  return (
    <PageGuard allow={["owner", "manager"]}>
      <CollateralPageContent />
    </PageGuard>
  );
}

function CollateralPageContent() {
  const { items, isLoading, refresh } = useHeldCollateral();
  const [returningId, setReturningId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleReturn(id: number) {
    setReturningId(id);
    setError(null);
    try {
      await apiClient.returnCollateral(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark this item as returned.");
    } finally {
      setReturningId(null);
    }
  }

  const columns: DataTableColumn<CollateralItemRow>[] = [
    { key: "item", header: "Item", render: (r) => r.itemDescription },
    {
      key: "customer",
      header: "Held for",
      render: (r) => (
        <>
          {r.customerName}
          {r.isTemporary ? <span className="ml-1 text-xs text-slate-400">(nishani)</span> : null}
        </>
      ),
    },
    { key: "table", header: "Table", render: (r) => r.tableLabel },
    { key: "heldAt", header: "Held since", render: (r) => formatDateTime(r.heldAt), sortValue: (r) => new Date(r.heldAt).getTime() },
    { key: "heldBy", header: "Held by", render: (r) => r.heldByName },
    {
      key: "action",
      header: "",
      sortable: false,
      render: (r) => (
        <RoleGate allow={CAN_RETURN_COLLATERAL}>
          <button
            className="btn-secondary text-xs"
            disabled={returningId === r.id}
            onClick={() => handleReturn(r.id)}
          >
            {returningId === r.id ? "Marking…" : "Mark returned"}
          </button>
        </RoleGate>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Collateral held</h1>
        <p className="page-subtitle">Items currently held in place of payment across all customers (decision #4).</p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Items currently held" value={String(items.length)} tone={items.length > 0 ? "warning" : "default"} />
      </section>

      {error ? (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</div>
      ) : null}

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing currently held" hint="Items appear here as soon as a receptionist records collateral instead of payment." />
      ) : (
        <DataTable columns={columns} rows={items} keyField={(r) => r.id} defaultSortKey="heldAt" defaultSortDir="asc" />
      )}
    </div>
  );
}
