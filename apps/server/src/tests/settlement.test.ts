import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { settlePayment } from "../services/ledgerService";

/**
 * Behavioral requirement from API_CONTRACT.md's Payments section: supports
 * partial settlement (a subset of a customer's unsettled rounds), backed by
 * the shared `validateSettlement`.
 */
describe("payment settlement", () => {
  async function seed(db: ReturnType<typeof createTestDb>) {
    const staff = await db.user.create({ data: { fullName: "Staff", username: "staff", role: "receptionist", pinHash: "x" } });
    const table = await db.table.create({ data: { tableNumber: 1, tableType: "standard", label: "Table 1" } });
    const gameType = await db.gameType.create({ data: { code: "6_ball", name: "6 Ball", defaultDurationMinutes: 25 } });
    const customer = await db.customer.create({ data: { displayName: "Loaner" } });
    const shift = await db.shift.create({ data: { userId: staff.id } });

    const gameA = await db.game.create({
      data: {
        localUuid: "s1", tableId: table.id, gameTypeId: gameType.id,
        startTime: new Date("2026-07-23T10:00:00Z"), endTime: new Date("2026-07-23T10:25:00Z"),
        priceOriginal: 100, priceFinal: 100, loserCustomerId: customer.id,
        paymentStatus: "pending", createdByUserId: staff.id, shiftId: shift.id,
      },
    });
    const gameB = await db.game.create({
      data: {
        localUuid: "s2", tableId: table.id, gameTypeId: gameType.id,
        startTime: new Date("2026-07-23T11:00:00Z"), endTime: new Date("2026-07-23T11:25:00Z"),
        priceOriginal: 150, priceFinal: 150, loserCustomerId: customer.id,
        paymentStatus: "loan", createdByUserId: staff.id, shiftId: shift.id,
      },
    });

    return { staff, customer, gameA, gameB };
  }

  it("settles a single round (partial settlement) and leaves the other unsettled", async () => {
    const db = createTestDb();
    const { staff, customer, gameA, gameB } = await seed(db);

    const payment = await settlePayment(
      db as any,
      { customerId: customer.id, amount: 100, method: "cash", gameIds: [gameA.id] },
      { userId: staff.id }
    );
    expect(payment.amount).toBe(100);

    const updatedA = await db.game.findUnique({ where: { id: gameA.id } });
    const updatedB = await db.game.findUnique({ where: { id: gameB.id } });
    expect(updatedA!.paymentStatus).toBe("paid");
    expect(updatedB!.paymentStatus).toBe("loan"); // untouched
  });

  it("settles both rounds together when the full amount is paid", async () => {
    const db = createTestDb();
    const { staff, customer, gameA, gameB } = await seed(db);

    await settlePayment(
      db as any,
      { customerId: customer.id, amount: 250, method: "easypaisa", gameIds: [gameA.id, gameB.id] },
      { userId: staff.id }
    );

    const updatedA = await db.game.findUnique({ where: { id: gameA.id } });
    const updatedB = await db.game.findUnique({ where: { id: gameB.id } });
    expect(updatedA!.paymentStatus).toBe("paid");
    expect(updatedB!.paymentStatus).toBe("paid");
  });

  it("rejects a settlement that includes a game not belonging to / not unsettled for this customer", async () => {
    const db = createTestDb();
    const { staff, customer, gameA } = await seed(db);

    const otherCustomer = await db.customer.create({ data: { displayName: "Someone Else" } });

    await expect(
      settlePayment(
        db as any,
        { customerId: otherCustomer.id, amount: 100, method: "cash", gameIds: [gameA.id] },
        { userId: staff.id }
      )
    ).rejects.toThrow(/not an unsettled round/);
  });

  it("rejects a settlement whose amount doesn't match the selected rounds' total", async () => {
    const db = createTestDb();
    const { staff, customer, gameA } = await seed(db);

    await expect(
      settlePayment(
        db as any,
        { customerId: customer.id, amount: 50, method: "cash", gameIds: [gameA.id] },
        { userId: staff.id }
      )
    ).rejects.toThrow(/must equal the sum/);
  });
});
