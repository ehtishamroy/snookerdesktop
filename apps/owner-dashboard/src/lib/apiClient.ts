import type { PaymentMethod, PaymentStatus, Role, TableType } from "@snooker/shared";
import { clearSession, getToken } from "./tokenStore";
import type {
  AuditLogRow,
  BalanceSheet,
  CollateralItemRow,
  CustomerEntity,
  CustomerLedgerWire,
  ExpenseEntity,
  FinancialAnalysis,
  GameTypeEntity,
  LoanLedgerEntry,
  LoginResponse,
  PayoutEntry,
  PricingRuleEntity,
  RevenueReport,
  ShiftEntity,
  StaffPerformanceEntry,
  TableDayTimelineWire,
  TableUtilizationWire,
  TableWithStatus,
  TrickedEntry,
  UserEntity,
} from "./apiTypes";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip attaching the Authorization header (only /auth/login needs this). */
  anonymous?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const base = API_BASE_URL.replace(/\/$/, "");
  let href = base + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) href += (href.includes("?") ? "&" : "?") + qs;
  }
  return href;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!options.anonymous) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  if (response.status === 401) {
    // Token expired/invalid — clear the stale session so the UI redirects to
    // /login on next render rather than looping on 401s.
    clearSession();
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    let body: unknown;
    try {
      body = contentType.includes("application/json") ? await response.json() : await response.text();
    } catch {
      body = undefined;
    }
    let message = `Request failed (${response.status})`;
    if (body && typeof body === "object" && "message" in body) {
      const raw = (body as { message?: unknown }).message;
      if (typeof raw === "string" && raw.length > 0) message = raw;
    }
    throw new ApiError(response.status, message, body);
  }

  if (response.status === 204) return undefined as T;
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

/** Builds a fully-qualified, auth-less URL string for CSV export links/downloads. */
export function apiUrl(path: string, query?: RequestOptions["query"]): string {
  return buildUrl(path, query);
}

export const apiClient = {
  baseUrl: API_BASE_URL,

  // ---- Auth ----
  login(username: string, pin: string) {
    return request<LoginResponse>("/auth/login", { method: "POST", body: { username, pin }, anonymous: true });
  },
  logout() {
    return request<void>("/auth/logout", { method: "POST" });
  },

  // ---- Users ----
  getUsers() {
    return request<UserEntity[]>("/users");
  },
  createUser(input: { fullName: string; username: string; role: Role; pin: string }) {
    return request<UserEntity>("/users", { method: "POST", body: input });
  },
  updateUser(id: number, input: { fullName?: string; role?: Role; isActive?: boolean; pin?: string }) {
    return request<UserEntity>(`/users/${id}`, { method: "PATCH", body: input });
  },

  // ---- Tables ----
  getTables() {
    return request<TableWithStatus[]>("/tables");
  },
  updateTable(id: number, input: { isActive: boolean }) {
    return request<TableWithStatus>(`/tables/${id}`, { method: "PATCH", body: input });
  },

  // ---- Game types ----
  getGameTypes() {
    return request<GameTypeEntity[]>("/game-types");
  },

  // ---- Pricing rules ----
  getActivePricingRules() {
    return request<PricingRuleEntity[]>("/pricing-rules", { query: { activeOnly: true } });
  },
  getPricingHistory(params: { tableType?: TableType; gameTypeId?: number }) {
    return request<PricingRuleEntity[]>("/pricing-rules/history", { query: params });
  },
  createPricingRule(input: { tableType: TableType; gameTypeId: number; price: number; durationMinutes: number }) {
    return request<PricingRuleEntity>("/pricing-rules", { method: "POST", body: input });
  },

  // ---- Customers ----
  searchCustomers(search: string) {
    return request<CustomerEntity[]>("/customers", { query: { search } });
  },
  getCustomerLedger(customerId: number) {
    return request<CustomerLedgerWire>(`/customers/${customerId}/ledger`);
  },
  createCustomer(input: { displayName: string; phone?: string; notes?: string }) {
    return request<CustomerEntity>("/customers", { method: "POST", body: input });
  },
  createNishani(input: { nishaniDescription: string }) {
    return request<CustomerEntity>("/customers/nishani", { method: "POST", body: input });
  },
  mergeCustomer(customerId: number, intoCustomerId: number) {
    return request<{ ok: true }>(`/customers/${customerId}/merge`, { method: "POST", body: { intoCustomerId } });
  },
  getLoanLedger() {
    return request<LoanLedgerEntry[]>("/customers/loan-ledger");
  },

  // ---- Collateral ----
  returnCollateral(id: number) {
    return request<CollateralItemRow>(`/collateral-items/${id}/return`, { method: "POST", body: {} });
  },
  getHeldCollateral() {
    // NOTE: not explicitly enumerated as a GET in API_CONTRACT.md (only the
    // create + return actions are). This list endpoint is required for the
    // Collateral page and follows the same `returned=false` filter
    // convention used by GET /games?...&reversed=false elsewhere in the
    // contract. Flagged in the README as an assumption for the server team
    // to confirm/implement.
    return request<CollateralItemRow[]>("/collateral-items", { query: { returned: false } });
  },

  // ---- Shifts ----
  getShifts(params: { userId?: number; from?: string; to?: string }) {
    return request<ShiftEntity[]>("/shifts", { query: params });
  },
  getZReport(shiftId: number) {
    return request<Record<string, unknown>>(`/shifts/${shiftId}/z-report`);
  },

  // ---- Expenses ----
  getExpenses(params: { from?: string; to?: string; shiftId?: number }) {
    return request<ExpenseEntity[]>("/expenses", { query: params });
  },

  // ---- Reports ----
  getRevenueReport(params: { tableId?: number; from: string; to: string }) {
    return request<RevenueReport>("/reports/revenue", { query: params });
  },
  getUtilizationReport(params: { tableId?: number; from: string; to: string }) {
    return request<TableUtilizationWire[]>("/reports/utilization", { query: params });
  },
  getTableDayTimelines(params: { date: string; tableId?: number }) {
    return request<TableDayTimelineWire[]>("/reports/table-day-timeline", { query: params });
  },
  getStaffPerformance(params: { from: string; to: string }) {
    return request<StaffPerformanceEntry[]>("/reports/staff-performance", { query: params });
  },
  getAuditLog(params: { entityType?: string; entityId?: number; performedBy?: number; from?: string; to?: string }) {
    return request<AuditLogRow[]>("/reports/audit-log", { query: params });
  },
  getTricked(params: { from?: string; to?: string }) {
    return request<TrickedEntry[]>("/reports/tricked", { query: params });
  },

  // ---- Capital / balance sheet (owner-only) ----
  getBalanceSheet() {
    return request<BalanceSheet>("/capital/balance-sheet");
  },
  setStartingBalance(input: { method: PaymentMethod; amount: number }) {
    return request<unknown>("/capital/starting-balance", { method: "PUT", body: input });
  },
  recordPayout(input: { amount: number; method: PaymentMethod; note?: string }) {
    return request<PayoutEntry>("/capital/payouts", { method: "POST", body: input });
  },
  getPayouts(params: { from?: string; to?: string } = {}) {
    return request<PayoutEntry[]>("/capital/payouts", { query: params });
  },
  getFinancialAnalysis(params: { monthsLookback?: number } = {}) {
    return request<FinancialAnalysis>("/capital/analysis", { query: params });
  },
};

export type { PaymentMethod, PaymentStatus };
