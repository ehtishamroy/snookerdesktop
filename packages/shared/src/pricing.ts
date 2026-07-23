/**
 * Pricing / overtime billing engine.
 *
 * Decision (owner, clarifying round): overtime bills strictly per minute, not
 * rounded up to the next full block and not a flat overtime fee. A game type's
 * listed price is for its listed block duration (e.g. Rs. 100 / 25 min for a
 * 6-Ball). Playing past the block is charged at that game type's per-minute
 * rate (price / block duration) for each additional minute, rounded up to the
 * next whole minute so partial overtime minutes are never given away free.
 *
 * Finishing *before* the block ends still bills the full block price — there
 * is no proration downward. This matches how the club has always billed and
 * keeps the rule simple/predictable for a busy counter.
 */

export interface PricingBlock {
  /** Price (PKR) for one full block of this game type, from pricing_rules. */
  blockPrice: number;
  /** Duration (minutes) of one billing block for this game type. */
  blockDurationMinutes: number;
}

export interface BillingResult {
  /** Minutes actually played (End Time − Start Time), unrounded. */
  durationActualMinutes: number;
  /** Minutes billed: block duration + any overtime minutes (rounded up). */
  durationBilledMinutes: number;
  /** Whole overtime minutes billed beyond the block, 0 if within the block. */
  overtimeMinutes: number;
  /** Per-minute rate used for overtime, derived from blockPrice / blockDurationMinutes. */
  perMinuteRate: number;
  /** Overtime charge only (PKR), rounded to the nearest whole rupee. */
  overtimeAmount: number;
  /** Full price before any discount: blockPrice + overtimeAmount. */
  priceOriginal: number;
}

export function computeBilling(
  block: PricingBlock,
  durationActualMinutes: number
): BillingResult {
  if (block.blockDurationMinutes <= 0) {
    throw new Error("blockDurationMinutes must be > 0");
  }
  if (durationActualMinutes < 0) {
    throw new Error("durationActualMinutes must be >= 0");
  }

  const perMinuteRate = block.blockPrice / block.blockDurationMinutes;

  if (durationActualMinutes <= block.blockDurationMinutes) {
    return {
      durationActualMinutes,
      durationBilledMinutes: block.blockDurationMinutes,
      overtimeMinutes: 0,
      perMinuteRate,
      overtimeAmount: 0,
      priceOriginal: block.blockPrice,
    };
  }

  const overtimeMinutes = Math.ceil(durationActualMinutes - block.blockDurationMinutes);
  const overtimeAmount = Math.round(overtimeMinutes * perMinuteRate);

  return {
    durationActualMinutes,
    durationBilledMinutes: block.blockDurationMinutes + overtimeMinutes,
    overtimeMinutes,
    perMinuteRate,
    overtimeAmount,
    priceOriginal: block.blockPrice + overtimeAmount,
  };
}

export interface DiscountInput {
  priceOriginal: number;
  /** Flat PKR amount, if the receptionist entered a flat discount. */
  discountAmount?: number;
  /** Percent (0-100), if the receptionist entered a percent discount instead. */
  discountPercent?: number;
}

export interface DiscountResult {
  discountAmount: number;
  priceFinal: number;
}

/**
 * Any staff member may apply any discount amount — there is no owner
 * approval gate (owner decision: unrestricted, staff is trusted). The
 * discount is still fully attributed (discount_reason + applied_by user id
 * in the caller's record) purely for audit/reporting, not as a gate.
 */
export function applyDiscount(input: DiscountInput): DiscountResult {
  const { priceOriginal } = input;
  let discountAmount = input.discountAmount ?? 0;

  if (input.discountPercent) {
    discountAmount = Math.round((priceOriginal * input.discountPercent) / 100);
  }

  discountAmount = Math.max(0, Math.min(discountAmount, priceOriginal));
  return {
    discountAmount,
    priceFinal: priceOriginal - discountAmount,
  };
}

/**
 * Live minutes-elapsed for a table tile / idle-timeout check, given a start
 * time and "now". Pure function of two Date-like inputs so it is trivially
 * testable and reusable between the desktop tile ticker and the idle alert.
 */
export function minutesElapsed(startTime: Date, now: Date): number {
  return (now.getTime() - startTime.getTime()) / 60000;
}
