import { PrismaClient } from "@prisma/client";
import { env } from "./env";

/**
 * PrismaClient singleton. Re-using one instance across the process avoids
 * exhausting Postgres connections (each PrismaClient owns its own pool) —
 * important with `tsx watch` hot-reloading in dev, and just correct hygiene
 * in production.
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
