import { describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import express from "express";
import request from "supertest";

// The auth router and its middleware import the PrismaClient singleton
// from "../db" directly (there's no per-request DB to inject for
// login/logout, unlike the services under src/services/*). Mocking the
// module here swaps in the same in-memory FakeDb used by every other test
// file, so this exercises the *real* route + middleware + jwt code against
// a fake but behaviorally-accurate store, with zero real Postgres needed.
vi.mock("../db", async () => {
  const { createTestDb } = await import("./testDb");
  return { prisma: createTestDb() };
});

import { prisma } from "../db";
import { authRouter } from "../routes/auth";
import { requireAuth, requireRole } from "../auth/middleware";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.get("/api/owner-only", requireAuth, requireRole("owner"), (req, res) => {
    res.json({ ok: true, user: req.user });
  });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number })?.status ?? 500;
    res.status(status).json({ error: (err as Error)?.message ?? "error" });
  });
  return app;
}

describe("auth flow", () => {
  it("logs in with a valid username/PIN and rejects an invalid one", async () => {
    const pinHash = await bcrypt.hash("445566", 10);
    await (prisma as any).user.create({
      data: { fullName: "Test Owner", username: "owner", role: "owner", pinHash },
    });

    const app = buildApp();

    const badLogin = await request(app).post("/api/auth/login").send({ username: "owner", pin: "000000" });
    expect(badLogin.status).toBe(401);

    const goodLogin = await request(app).post("/api/auth/login").send({ username: "owner", pin: "445566" });
    expect(goodLogin.status).toBe(200);
    expect(goodLogin.body.token).toBeTruthy();
    expect(goodLogin.body.user.username).toBe("owner");
  });

  it("rejects requests with no token, and enforces role gating for a protected route", async () => {
    const pinHash = await bcrypt.hash("112233", 10);
    await (prisma as any).user.create({
      data: { fullName: "Test Receptionist", username: "recep2", role: "receptionist", pinHash },
    });

    const app = buildApp();

    const noAuth = await request(app).get("/api/owner-only");
    expect(noAuth.status).toBe(401);

    const login = await request(app).post("/api/auth/login").send({ username: "recep2", pin: "112233" });
    const token = login.body.token as string;

    const forbidden = await request(app).get("/api/owner-only").set("Authorization", `Bearer ${token}`);
    expect(forbidden.status).toBe(403);
  });

  it("logout force-closes the caller's open shift (decision #5 / requirement #1)", async () => {
    const pinHash = await bcrypt.hash("998877", 10);
    const user = await (prisma as any).user.create({
      data: { fullName: "Shift Owner", username: "shiftowner", role: "owner", pinHash },
    });
    const shift = await (prisma as any).shift.create({ data: { userId: user.id } });

    const app = buildApp();
    const login = await request(app).post("/api/auth/login").send({ username: "shiftowner", pin: "998877" });
    const token = login.body.token as string;

    const logout = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`).send({});
    expect(logout.status).toBe(200);
    expect(logout.body.shiftClosed).toBe(true);

    const closedShift = await (prisma as any).shift.findUnique({ where: { id: shift.id } });
    expect(closedShift.closedAt).not.toBeNull();
    expect(closedShift.isLocked).toBe(true);
    // No declaredCashAmount was supplied — falls back to the computed
    // systemCashTotal (0, since there were no payments/expenses), per the
    // documented fallback in shiftService.closeOpenShiftForLogout.
    expect(closedShift.declaredCashAmount).toBe(0);
  });
});
