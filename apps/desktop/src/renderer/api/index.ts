/**
 * Thin, typed wrapper around `window.api` (exposed by src/main/preload.ts).
 * Screens/components import from here rather than touching `window.api`
 * directly so call sites read naturally and stay typed against
 * @snooker/shared + src/ipc/contract.ts in one place.
 */
export const api = window.api;

export * from "../../ipc/contract";
// Re-export the wire-format/business-logic types too (Role, TableType,
// PaymentMethod, PaymentStatus, *Entity, ZReport, etc.) so screens can import
// everything they need from this one module instead of reaching into
// @snooker/shared directly for plain type imports.
export type {
  AuditLogEntity,
  CollateralItemEntity,
  CustomerEntity,
  ExpenseEntity,
  GameEntity,
  GameTypeCode,
  GameTypeEntity,
  PaymentEntity,
  PaymentMethod,
  PaymentStatus,
  PricingRuleEntity,
  Role,
  ShiftEntity,
  TableEntity,
  TableType,
  UserEntity,
  ZReport,
} from "@snooker/shared";
