import { describe, expect, it } from "vitest";
import { checkIdleAlert } from "./idle";

describe("checkIdleAlert (forgotten End Game detection)", () => {
  it("does not alert within the normal block duration", () => {
    const result = checkIdleAlert({
      startTime: new Date("2026-07-23T10:00:00Z"),
      now: new Date("2026-07-23T10:20:00Z"),
      blockDurationMinutes: 25,
    });
    expect(result.isIdleAlert).toBe(false);
  });

  it("does not alert during normal overtime", () => {
    const result = checkIdleAlert({
      startTime: new Date("2026-07-23T10:00:00Z"),
      now: new Date("2026-07-23T10:40:00Z"),
      blockDurationMinutes: 25,
    });
    expect(result.isIdleAlert).toBe(false);
  });

  it("alerts once elapsed time passes double the block duration", () => {
    const result = checkIdleAlert({
      startTime: new Date("2026-07-23T10:00:00Z"),
      now: new Date("2026-07-23T10:51:00Z"),
      blockDurationMinutes: 25,
    });
    expect(result.isIdleAlert).toBe(true);
    expect(result.thresholdMinutes).toBe(50);
  });
});
