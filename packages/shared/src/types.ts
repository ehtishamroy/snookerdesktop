import type { GameTypeCode, PaymentMethod, PaymentStatus, Role, TableType } from "./constants";

/** Wire-format domain types shared between the server (Postgres/Prisma) and the
 * desktop app (local SQLite). Field names intentionally mirror the DB columns
 * so sync payloads can be mapped 1:1 without a translation layer. */

export interface TableEntity {
  id: number;
  tableNumber: number;
  tableType: TableType;
  label: string;
  isActive: boolean;
}

export interface GameTypeEntity {
  id: number;
  code: GameTypeCode;
  name: string;
  defaultDurationMinutes: number;
  isActive: boolean;
}

export interface PricingRuleEntity {
  id: number;
  tableType: TableType;
  gameTypeId: number;
  price: number;
  durationMinutes: number;
  effectiveFrom: string; // ISO timestamp
  effectiveTo: string | null;
  createdBy: number;
}

export interface CustomerEntity {
  id: number;
  displayName: string;
  isTemporary: boolean;
  nishaniDescription: string | null;
  mergedIntoCustomerId: number | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserEntity {
  id: number;
  fullName: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface GameEntity {
  id: number;
  localUuid: string;
  tableId: number;
  gameTypeId: number;
  startTime: string;
  endTime: string | null;
  durationActualMinutes: number | null;
  durationBilledMinutes: number | null;
  priceOriginal: number;
  discountAmount: number;
  discountReason: string | null;
  discountByUserId: number | null;
  priceFinal: number;
  loserCustomerId: number | null;
  winnerCustomerId: number | null;
  paymentStatus: PaymentStatus;
  createdByUserId: number;
  shiftId: number;
  reversed: boolean;
  reversedBy: number | null;
  reversedReason: string | null;
  reversedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentEntity {
  id: number;
  customerId: number;
  amount: number;
  method: PaymentMethod;
  note: string | null;
  paidAt: string;
  collectedByUserId: number;
  shiftId: number;
  gameIds: number[];
}

export interface CollateralItemEntity {
  id: number;
  gameId: number;
  customerId: number;
  itemDescription: string;
  heldByUserId: number;
  heldAt: string;
  returned: boolean;
  returnedAt: string | null;
  returnedByUserId: number | null;
}

export interface TableStatusLogEntity {
  id: number;
  tableId: number;
  status: "occupied" | "vacant";
  statusFrom: string;
  statusTo: string | null;
}

export interface ShiftEntity {
  id: number;
  userId: number;
  openedAt: string;
  closedAt: string | null;
  declaredCashAmount: number | null;
  systemCashTotal: number | null;
  cashVariance: number | null;
  isLocked: boolean;
  closedByUserId: number | null;
}

export interface ExpenseEntity {
  id: number;
  category: string;
  amount: number;
  method: PaymentMethod;
  note: string | null;
  spentAt: string;
  recordedByUserId: number;
  shiftId: number;
  /** Set whenever this expense is corrected after creation, so the owner can spot an edited entry at a glance. */
  edited: boolean;
  editedAt: string | null;
  editedById: number | null;
}

export interface AuditLogEntity {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  beforeValue: unknown;
  afterValue: unknown;
  performedBy: number;
  performedAt: string;
}
