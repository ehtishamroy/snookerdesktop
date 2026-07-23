import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { resolvePricingRule } from "../services/pricingService";

/**
 * Behavioral requirement #5 / decision #2: pricing resolution must pick the
 * pricing_rules row that was effective at the game's start_time, not
 * whatever is active "now" — this is what keeps historical reports honest
 * after the owner changes prices.
 */
describe("resolvePricingRule", () => {
  it("picks the historical price that was effective at the given time, not the current one", async () => {
    const db = createTestDb();
    const owner = await db.user.create({ data: { fullName: "Owner", username: "owner", role: "owner", pinHash: "x" } });
    const gameType = await db.gameType.create({ data: { code: "6_ball", name: "6 Ball", defaultDurationMinutes: 25 } });

    // Old price: Rs 80 / 25min, effective Jan 1 - Jun 1
    await db.pricingRule.create({
      data: {
        tableType: "standard",
        gameTypeId: gameType.id,
        price: 80,
        durationMinutes: 25,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        effectiveTo: new Date("2026-06-01T00:00:00Z"),
        createdById: owner.id,
      },
    });
    // New price: Rs 100 / 25min, effective Jun 1 onward
    await db.pricingRule.create({
      data: {
        tableType: "standard",
        gameTypeId: gameType.id,
        price: 100,
        durationMinutes: 25,
        effectiveFrom: new Date("2026-06-01T00:00:00Z"),
        effectiveTo: null,
        createdById: owner.id,
      },
    });

    const duringOldPrice = await resolvePricingRule(db as any, "standard", gameType.id, new Date("2026-03-15T00:00:00Z"));
    expect(duringOldPrice.blockPrice).toBe(80);

    const exactlyAtChangeover = await resolvePricingRule(db as any, "standard", gameType.id, new Date("2026-06-01T00:00:00Z"));
    expect(exactlyAtChangeover.blockPrice).toBe(100);

    const afterNewPrice = await resolvePricingRule(db as any, "standard", gameType.id, new Date("2026-07-23T00:00:00Z"));
    expect(afterNewPrice.blockPrice).toBe(100);

    const beforeAnyRuleExisted = resolvePricingRule(db as any, "standard", gameType.id, new Date("2025-01-01T00:00:00Z"));
    await expect(beforeAnyRuleExisted).rejects.toThrow(/No pricing rule/);
  });

  it("scopes by tableType so private_room and standard prices don't leak into each other", async () => {
    const db = createTestDb();
    const owner = await db.user.create({ data: { fullName: "Owner", username: "owner", role: "owner", pinHash: "x" } });
    const gameType = await db.gameType.create({ data: { code: "century", name: "Century", defaultDurationMinutes: 60 } });

    await db.pricingRule.create({
      data: { tableType: "standard", gameTypeId: gameType.id, price: 600, durationMinutes: 60, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, createdById: owner.id },
    });
    await db.pricingRule.create({
      data: { tableType: "private_room", gameTypeId: gameType.id, price: 1000, durationMinutes: 60, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, createdById: owner.id },
    });

    const standard = await resolvePricingRule(db as any, "standard", gameType.id, new Date());
    const privateRoom = await resolvePricingRule(db as any, "private_room", gameType.id, new Date());
    expect(standard.blockPrice).toBe(600);
    expect(privateRoom.blockPrice).toBe(1000);
  });
});
