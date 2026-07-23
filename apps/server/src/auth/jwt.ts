import jwt from "jsonwebtoken";
import type { Role } from "@snooker/shared";
import { env } from "../env";

/** The JWT payload shape, per API_CONTRACT.md: "{ userId, role, fullName, username }". */
export interface JwtPayload {
  userId: number;
  role: Role;
  fullName: string;
  username: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string") {
    throw new Error("Malformed token payload");
  }
  return decoded as unknown as JwtPayload;
}
