import type { Response } from "express";

/**
 * Minimal, dependency-free CSV serializer used by every /reports/* endpoint
 * when `?format=csv` is passed (behavioral requirement #10). Handles the
 * common escaping cases (comma, quote, newline) per RFC 4180; good enough
 * for report exports without pulling in a CSV library for something this
 * small.
 */
function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows.length > 0 ? Object.keys(rows[0]!) : []);
  const lines = [cols.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => escapeCsvCell(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Streams `rows` as a CSV file download response. */
export function sendCsv(res: Response, filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  const csv = toCsv(rows, columns);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}
