import type {
  AuditLogEntity,
  CollateralItemEntity,
  CustomerEntity,
  ExpenseEntity,
  GameTypeEntity,
  PaymentMethod,
  PaymentStatus,
  PricingRuleEntity,
  Role,
  ShiftEntity,
  TableEntity,
  TableType,
  UnsettledPaymentStatus,
  UserEntity,
} from "@snooker/shared";

/**
 * Wire-shape types for endpoints in docs/API_CONTRACT.md whose exact JSON
 * response body isn't fully specified there (the contract describes intent
 * and inputs precisely, but report/list response shapes are left to the
 * implementer). These interfaces are this dashboard's expectation of what
 * apps/server returns; if the server's actual field names differ, only this
 * file + lib/apiClient.ts need to change.
 */

export type MethodTotals = Record<PaymentMethod, number>;
export type StatusTotals = Record<PaymentStatus, number>;

export const ZERO_METHOD_TOTALS: MethodTotals = { cash: 0, easypaisa: 0, jazzcash: 0, card: 0 };
export const ZERO_STATUS_TOTALS: StatusTotals = {
  paid: 0,
  pending: 0,
  loan: 0,
  collateral: 0,
  tricked: 0,
};

export interface LoginResponse {
  token: string;
  user: {
    id: number;
    fullName: string;
    username: string;
    role: Role;
    isActive: boolean;
  };
}

export interface ActiveGameSummary {
  gameId: number;
  gameTypeId: number;
  gameTypeName: string;
  startTime: string; // ISO
  loserCustomerId: number | null;
  loserCustomerName: string | null;
  blockDurationMinutes: number;
  isIdleAlert: boolean;
}

export interface TableWithStatus extends TableEntity {
  status: "occupied" | "vacant";
  activeGame: ActiveGameSummary | null;
  todayEarnings: number;
}

export interface DailyRevenuePoint {
  date: string; // ISO date (yyyy-MM-dd)
  total: number;
  byMethod: MethodTotals;
}

export interface TableRevenueBreakdown {
  tableId: number;
  tableNumber: number;
  tableLabel: string;
  tableType: TableType;
  total: number;
  byMethod: MethodTotals;
  byStatus: StatusTotals;
  daysInRange: number;
  dailyAverage: number;
  series: DailyRevenuePoint[];
}

export interface RevenueReport {
  from: string;
  to: string;
  overall: {
    total: number;
    byMethod: MethodTotals;
    byStatus: StatusTotals;
    daysInRange: number;
    dailyAverage: number;
    series: DailyRevenuePoint[];
  };
  perTable: TableRevenueBreakdown[];
}

export interface VacantWindowWire {
  from: string;
  to: string;
}

export interface TableUtilizationWire {
  tableId: number;
  tableNumber: number;
  tableLabel: string;
  occupiedMinutes: number;
  vacantMinutes: number;
  totalMinutes: number;
  utilizationPercent: number;
  vacantWindows: VacantWindowWire[];
}

export interface StaffShiftSummary {
  shiftId: number;
  openedAt: string;
  closedAt: string | null;
  declaredCashAmount: number | null;
  systemCashTotal: number | null;
  cashVariance: number | null;
  isLocked: boolean;
}

export interface StaffPerformanceEntry {
  userId: number;
  fullName: string;
  username: string;
  role: Role;
  isActive: boolean;
  totalCollected: number;
  byMethod: MethodTotals;
  gamesHandled: number;
  discountsGiven: number;
  shifts: StaffShiftSummary[];
}

export interface TrickedEntry {
  gameId: number;
  tableId: number;
  tableLabel: string;
  gameTypeName: string;
  customerId: number;
  customerName: string;
  isTemporary: boolean;
  startTime: string;
  endTime: string | null;
  priceFinal: number;
  createdByUserId: number;
  createdByName: string;
}

export interface LoanLedgerEntry {
  customerId: number;
  displayName: string;
  isTemporary: boolean;
  nishaniDescription: string | null;
  phone: string | null;
  totalOwed: number;
  unsettledCount: number;
  statuses: UnsettledPaymentStatus[];
  spanStart: string | null;
  spanEnd: string | null;
}

export interface CustomerLedgerGameWire {
  gameId: number;
  tableNumber: number;
  gameTypeName: string;
  startTime: string;
  endTime: string;
  priceFinal: number;
  paymentStatus: UnsettledPaymentStatus;
}

export interface CustomerLedgerWire {
  customerId: number;
  customerName: string;
  isTemporary: boolean;
  unsettledGames: CustomerLedgerGameWire[];
  totalOwed: number;
  spanStart: string | null;
  spanEnd: string | null;
  spanMinutes: number;
}

export interface AuditLogRow extends AuditLogEntity {
  performedByName: string;
  entityLabel?: string | null;
}

export interface CollateralItemRow extends CollateralItemEntity {
  customerName: string;
  isTemporary: boolean;
  tableLabel: string;
  gameStartTime: string;
  heldByName: string;
  returnedByName: string | null;
}

export type { GameTypeEntity, PricingRuleEntity, CustomerEntity, ExpenseEntity, ShiftEntity, UserEntity };
