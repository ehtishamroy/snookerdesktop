import type { JwtPayload } from "../auth/jwt";

declare global {
  namespace Express {
    interface Request {
      /** Populated by requireAuth once the JWT has been verified and the user re-checked against the DB. */
      user?: JwtPayload;
    }
  }
}

export {};
