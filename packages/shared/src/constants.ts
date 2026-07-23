/**
 * Business-rule constants agreed with the owner. See /docs/DECISIONS.md for the
 * full rationale behind each of these — they come directly from the clarifying
 * Q&A round on the original spec, not from the spec's own defaults.
 */

export const ROLES = ["owner", "manager", "receptionist"] as const;
export type Role = (typeof ROLES)[number];

export const TABLE_TYPES = ["standard", "private_room"] as const;
export type TableType = (typeof TABLE_TYPES)[number];

// Table maintenance status was explicitly dropped (owner: "no need"). A table is
// either occupied or vacant; taking a table offline is a simple is_active flag,
// not a tracked state that would otherwise pollute vacancy-fraud analysis.
export const TABLE_STATUSES = ["occupied", "vacant"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "paid",
  "pending",
  "loan",
  "collateral",
  "tricked",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// Multiple payment methods are captured explicitly so end-of-day reconciliation
// can answer "how much cash vs EasyPaisa vs JazzCash vs card should be on hand".
export const PAYMENT_METHODS = ["cash", "easypaisa", "jazzcash", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// No peak/off-peak or weekend pricing — the owner can change prices at any time,
// and every change is versioned (effective_from/effective_to) so past sessions
// keep the price that applied when they were played.
export const GAME_TYPE_CODES = [
  "6_ball",
  "6_ball_double",
  "full_frame",
  "full_frame_double",
  "century",
] as const;
export type GameTypeCode = (typeof GAME_TYPE_CODES)[number];

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "reverse",
  "merge",
  "return_collateral",
  "shift_open",
  "shift_close",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Idle-timeout alert: a game running past this multiple of its billed block is flagged. */
export const IDLE_ALERT_MULTIPLIER = 2;

/** Cash variance beyond this (PKR) is highlighted on the Z-report as needing owner attention. */
export const CASH_VARIANCE_ATTENTION_THRESHOLD = 100;
