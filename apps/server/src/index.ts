import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cron from "node-cron";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { env } from "./env";
import { prisma } from "./db";
import { ApiError } from "./lib/errors";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { tablesRouter } from "./routes/tables";
import { gameTypesRouter } from "./routes/gameTypes";
import { pricingRulesRouter } from "./routes/pricingRules";
import { customersRouter } from "./routes/customers";
import { gamesRouter } from "./routes/games";
import { paymentsRouter } from "./routes/payments";
import { collateralRouter } from "./routes/collateral";
import { shiftsRouter } from "./routes/shifts";
import { expensesRouter } from "./routes/expenses";
import { reportsRouter } from "./routes/reports";
import { capitalRouter } from "./routes/capital";
import { syncRouter } from "./routes/sync";
import { jobsRouter } from "./routes/jobs";
import { purgeNishani } from "./jobs/purgeNishani";
import { scanIdleAlerts } from "./jobs/idleAlertScan";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.CORS_ORIGINS.includes("*") ? true : env.CORS_ORIGINS,
    })
  );
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/tables", tablesRouter);
  app.use("/api/game-types", gameTypesRouter);
  app.use("/api/pricing-rules", pricingRulesRouter);
  app.use("/api/customers", customersRouter);
  app.use("/api/games", gamesRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/collateral-items", collateralRouter);
  app.use("/api/shifts", shiftsRouter);
  app.use("/api/expenses", expensesRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/capital", capitalRouter);
  app.use("/api/sync", syncRouter);
  app.use("/api/jobs", jobsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Centralized error handler — every route uses asyncHandler() so thrown
  // errors (ApiError, zod ZodError, or unexpected ones) all land here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation error", details: err.flatten() });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return res.status(409).json({ error: "A record with this value already exists", details: err.meta });
      }
      if (err.code === "P2025") {
        return res.status(404).json({ error: "Record not found", details: err.meta });
      }
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

function startBackgroundJobs() {
  cron.schedule(env.NISHANI_PURGE_CRON, async () => {
    try {
      const result = await purgeNishani(prisma);
      if (result.purgedCount > 0) {
        // eslint-disable-next-line no-console
        console.log(`[purge-nishani] purged ${result.purgedCount} temporary customer(s): ${result.purgedIds.join(", ")}`);
      }
    } catch (err) {
      console.error("[purge-nishani] job failed", err);
    }
  });

  cron.schedule(env.IDLE_ALERT_SCAN_CRON, async () => {
    try {
      await scanIdleAlerts(prisma);
    } catch (err) {
      console.error("[idle-alert-scan] job failed", err);
    }
  });
}

/* istanbul ignore next -- exercised via integration/manual run, not unit tests */
if (require.main === module) {
  const app = createApp();
  startBackgroundJobs();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`snooker server listening on port ${env.PORT}`);
  });
}
