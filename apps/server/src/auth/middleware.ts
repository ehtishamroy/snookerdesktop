import type { NextFunction, Request, Response } from "express";
import type { Role } from "@snooker/shared";
import { verifyToken } from "./jwt";
import { prisma } from "../db";
import { ApiError } from "../lib/errors";

/**
 * Verifies the Bearer JWT and re-checks the user's active/role status
 * against the DB on every request (not just at login). This is a deliberate
 * choice over trusting the JWT claims verbatim: JWTs are stateless and
 * can't be revoked, but a fired/suspended staff member's `isActive` flag
 * (or a role change) needs to take effect immediately, not only after their
 * token happens to expire. The extra query is cheap (indexed PK lookup) and
 * worth the correctness guarantee for a small club-scale deployment.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw ApiError.unauthorized("Missing or malformed Authorization header");
    }
    const token = header.slice("Bearer ".length).trim();
    const payload = verifyToken(token);

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) {
      throw ApiError.unauthorized("Account is inactive or no longer exists");
    }

    // Refresh role/fullName/username from the DB in case they changed since
    // the token was issued (e.g. owner changed someone's role mid-shift).
    req.user = {
      userId: user.id,
      role: user.role as Role,
      fullName: user.fullName,
      username: user.username,
    };
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(ApiError.unauthorized("Invalid or expired token"));
  }
}

/** Restricts a route to one or more roles. Must run after requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`This action requires role: ${roles.join(" or ")}`));
    }
    next();
  };
}
