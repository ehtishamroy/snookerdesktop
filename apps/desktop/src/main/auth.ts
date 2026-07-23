/**
 * PIN hashing for local, fully-offline login. Uses Node's built-in
 * `crypto.scrypt` (no native dependency beyond what Node/Electron already
 * ships) rather than bcrypt, since a receptionist must be able to log in
 * with zero internet connectivity and we want to avoid a second native
 * addon alongside better-sqlite3.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

/** Format: scrypt$<saltHex>$<hashHex> */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  const actual = scryptSync(pin, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
