import { describe, expect, it } from "vitest";
import { computeUtilization } from "./utilization";

describe("computeUtilization (table vacancy tracking / CCTV cross-check)", () => {
  it("splits occupied vs vacant minutes and lists vacant windows", () => {
    const now = new Date("2026-07-23T12:00:00Z");
    const result = computeUtilization(
      [
        { status: "vacant", statusFrom: new Date("2026-07-23T09:00:00Z"), statusTo: new Date("2026-07-23T09:30:00Z") },
        { status: "occupied", statusFrom: new Date("2026-07-23T09:30:00Z"), statusTo: new Date("2026-07-23T10:00:00Z") },
        { status: "vacant", statusFrom: new Date("2026-07-23T10:00:00Z"), statusTo: null },
      ],
      now
    );

    expect(result.occupiedMinutes).toBe(30);
    expect(result.vacantMinutes).toBe(150); // 30 + 120 (open window to "now")
    expect(result.totalMinutes).toBe(180);
    expect(result.utilizationPercent).toBeCloseTo((30 / 180) * 100, 5);
    expect(result.vacantWindows).toHaveLength(2);
  });
});
