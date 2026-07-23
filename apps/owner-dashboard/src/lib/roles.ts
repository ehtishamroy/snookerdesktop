import type { Role } from "@snooker/shared";

/**
 * Role-based access rules for this dashboard, transcribed from spec §6's
 * Roles & Permissions Matrix (docs/API_CONTRACT.md re-confirms these at the
 * top of the file), with the discount-approval row dropped per decision #3
 * (no approval gate exists, so there is nothing to gate in the UI either).
 *
 * Interpretation note (documented per task instructions): the spec lists
 * "View full audit log" as Manager = "partial", Owner = full. Nothing else
 * in the spec or DECISIONS.md defines what "partial" excludes. This build
 * interprets it as: a manager can see every audit_log entry (who/when/why,
 * same as owner) but destructive/owner-level administrative actions — i.e.
 * managing staff accounts and editing global pricing — remain owner-only,
 * consistent with the rest of the matrix. We do NOT hide any audit rows
 * from managers, since partially hiding *which* entries a manager can see
 * would itself need a rule the spec never states, and hiding fraud-relevant
 * history from the one role explicitly trusted to review reversals would
 * undermine the audit trail's whole purpose. The alternative reading (some
 * entity types hidden) was rejected as unspecifiable without guessing.
 */

export const NAV_PERMISSIONS = {
  dashboard: ["owner", "manager", "receptionist"],
  analytics: ["owner", "manager"],
  ledger: ["owner", "manager"],
  staff: ["owner", "manager"],
  expenses: ["owner", "manager"],
  history: ["owner", "manager"],
  collateral: ["owner", "manager"],
  adminPricing: ["owner"],
  adminStaff: ["owner"],
  adminMerge: ["owner", "manager"],
} as const satisfies Record<string, readonly Role[]>;

export type NavKey = keyof typeof NAV_PERMISSIONS;

export function canAccess(role: Role | undefined, key: NavKey): boolean {
  if (!role) return false;
  return (NAV_PERMISSIONS[key] as readonly Role[]).includes(role);
}

export const CAN_EDIT_PRICING: readonly Role[] = ["owner"];
export const CAN_MANAGE_STAFF: readonly Role[] = ["owner"];
/** Toggling a table active/inactive is the only per-table admin action (decision #8 dropped maintenance-mode). */
export const CAN_MANAGE_TABLES: readonly Role[] = ["owner"];
export const CAN_MERGE_CUSTOMERS: readonly Role[] = ["owner", "manager"];
export const CAN_RETURN_COLLATERAL: readonly Role[] = ["owner", "manager"];
export const CAN_VIEW_ALL_STAFF_TOTALS: readonly Role[] = ["owner", "manager"];

/** Receptionists have no dashboard access per spec §6, but must degrade
 * gracefully (own-shift-only view) rather than crash if one logs in anyway. */
export function isReceptionistDegraded(role: Role | undefined): boolean {
  return role === "receptionist";
}
