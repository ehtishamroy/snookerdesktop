"use client";

import { useMemo, useState } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  /** Value used for sorting when this column is active; defaults to render() text content if omitted. */
  sortValue?: (row: T) => string | number;
  className?: string;
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  keyField: (row: T) => string | number;
  emptyMessage?: string;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  isLoading?: boolean;
  /** Optional row-level highlight predicate, e.g. flagging tricked entries. */
  rowClassName?: (row: T) => string;
}

/** Generic sortable data table used across analytics/ledger/staff/expenses/history pages. */
export function DataTable<T>({
  columns,
  rows,
  keyField,
  emptyMessage = "No data for this range.",
  defaultSortKey,
  defaultSortDir = "desc",
  isLoading,
  rowClassName,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const getValue = col.sortValue ?? ((row: T) => String(col.render(row)));
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [rows, sortKey, sortDir, columns]);

  function toggleSort(key: string, sortable?: boolean) {
    if (sortable === false) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key, col.sortable)}
                className={`whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                  col.sortable === false ? "" : "cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200"
                } ${col.className ?? ""}`}
              >
                {col.header}
                {sortKey === col.key ? <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">
                Loading…
              </td>
            </tr>
          ) : sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={keyField(row)}
                className={`border-b border-slate-100 last:border-0 dark:border-slate-800/70 ${rowClassName?.(row) ?? ""}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`whitespace-nowrap px-3 py-2 text-slate-700 dark:text-slate-200 ${col.className ?? ""}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
