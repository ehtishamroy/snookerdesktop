import { describe, expect, it } from "vitest";
import { applyDiscount, computeBilling } from "./pricing";

describe("computeBilling", () => {
  it("bills the full block price when played within the block duration", () => {
    const result = computeBilling({ blockPrice: 100, blockDurationMinutes: 25 }, 20);
    expect(result.priceOriginal).toBe(100);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.durationBilledMinutes).toBe(25);
  });

  it("bills the full block price when played exactly to the block duration", () => {
    const result = computeBilling({ blockPrice: 100, blockDurationMinutes: 25 }, 25);
    expect(result.priceOriginal).toBe(100);
    expect(result.overtimeMinutes).toBe(0);
  });

  it("bills overtime per minute, rounded up, past the block", () => {
    // 6-ball: 100 PKR / 25 min => 4 PKR/min. 32 min played => 7 min over, rounded up.
    const result = computeBilling({ blockPrice: 100, blockDurationMinutes: 25 }, 32);
    expect(result.perMinuteRate).toBe(4);
    expect(result.overtimeMinutes).toBe(7);
    expect(result.overtimeAmount).toBe(28);
    expect(result.priceOriginal).toBe(128);
    expect(result.durationBilledMinutes).toBe(32);
  });

  it("rounds up partial overtime minutes rather than truncating", () => {
    // 30.2 minutes actual against a 25 min block => 5.2 min over => rounds up to 6.
    const result = computeBilling({ blockPrice: 100, blockDurationMinutes: 25 }, 30.2);
    expect(result.overtimeMinutes).toBe(6);
  });

  it("handles the century (60 min) block the same way", () => {
    const result = computeBilling({ blockPrice: 600, blockDurationMinutes: 60 }, 75);
    expect(result.perMinuteRate).toBe(10);
    expect(result.overtimeMinutes).toBe(15);
    expect(result.overtimeAmount).toBe(150);
    expect(result.priceOriginal).toBe(750);
  });

  it("throws on a non-positive block duration", () => {
    expect(() => computeBilling({ blockPrice: 100, blockDurationMinutes: 0 }, 10)).toThrow();
  });
});

describe("applyDiscount", () => {
  it("applies a flat discount", () => {
    const result = applyDiscount({ priceOriginal: 200, discountAmount: 50 });
    expect(result.discountAmount).toBe(50);
    expect(result.priceFinal).toBe(150);
  });

  it("applies a percent discount, rounded", () => {
    const result = applyDiscount({ priceOriginal: 150, discountPercent: 10 });
    expect(result.discountAmount).toBe(15);
    expect(result.priceFinal).toBe(135);
  });

  it("never discounts below zero even if the amount exceeds the price", () => {
    const result = applyDiscount({ priceOriginal: 100, discountAmount: 500 });
    expect(result.discountAmount).toBe(100);
    expect(result.priceFinal).toBe(0);
  });

  it("is not gated by any approval threshold — any staff member's discount is accepted as-is", () => {
    // No thresholds, no approvedBy requirement in the input shape at all.
    const result = applyDiscount({ priceOriginal: 1000, discountAmount: 900 });
    expect(result.priceFinal).toBe(100);
  });
});
