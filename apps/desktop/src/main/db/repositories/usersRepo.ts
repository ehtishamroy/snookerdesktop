import { randomUUID } from "node:crypto";
import type { Role, UserEntity } from "@snooker/shared";
import { getDb } from "../client";
import { enqueueSyncWrite } from "./syncQueueRepo";
import { writeAuditLog } from "./auditLogRepo";
import { hashPin, verifyPin } from "../../auth";

function mapRow(row: any): UserEntity {
  return {
    id: row.id,
    fullName: row.full_name,
    username: row.username,
    role: row.role,
    isActive: !!row.is_active,
    createdAt: row.created_at,
  };
}

export function findUserByUsername(username: string): (UserEntity & { pinHash: string }) | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`).get(username.trim());
  if (!row) return null;
  return { ...mapRow(row), pinHash: (row as any).pin_hash };
}

export function getUserById(userId: number): UserEntity {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (!row) throw new Error(`User ${userId} not found`);
  return mapRow(row);
}

/** Verifies username + PIN entirely locally, so login works with zero internet (spec §11). */
export function verifyLogin(username: string, pin: string): UserEntity | null {
  const found = findUserByUsername(username);
  if (!found || !found.isActive) return null;
  if (!verifyPin(pin, found.pinHash)) return null;
  const { pinHash: _pinHash, ...user } = found;
  return user;
}

export function listUsers(): UserEntity[] {
  const db = getDb();
  return (db.prepare(`SELECT * FROM users WHERE username != '__system__' ORDER BY full_name ASC`).all() as any[]).map(mapRow);
}

/** The unlisted system account used to attribute automated audit_log entries (see sync/pullMerge.ts). */
export function getSystemUserId(): number {
  const db = getDb();
  const row = db.prepare(`SELECT id FROM users WHERE username = '__system__'`).get() as { id: number } | undefined;
  if (!row) throw new Error("System user not found — database was not seeded correctly");
  return row.id;
}

/** Owner only (enforced by the IPC layer per docs/API_CONTRACT.md — "Users (owner only for mutations)"). */
export function createUser(input: {
  fullName: string;
  username: string;
  role: Role;
  pin: string;
  performedByUserId: number;
}): UserEntity {
  const db = getDb();
  const localUuid = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO users (local_uuid, full_name, username, role, pin_hash, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(localUuid, input.fullName.trim(), input.username.trim(), input.role, hashPin(input.pin), now, now);
    const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(Number(result.lastInsertRowid));
    const entity = mapRow(row);
    // pin_hash is never included in the sync payload's plaintext form — the
    // hash itself travels (same as what's stored locally), never the raw PIN.
    enqueueSyncWrite(db, {
      localUuid,
      entityType: "users",
      operation: "insert",
      payload: { ...entity, pinHash: (row as any).pin_hash },
    });
    writeAuditLog(db, {
      entityType: "users",
      entityId: entity.id,
      action: "create",
      afterValue: entity,
      performedById: input.performedByUserId,
    });
    return entity;
  });
  return tx();
}

/** Owner only: edit staff (deactivate, change role/name) and/or reset PIN. */
export function updateUser(
  input: { id: number; fullName?: string; role?: Role; isActive?: boolean; pin?: string },
  performedByUserId: number
): UserEntity {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const before = getUserById(input.id);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.fullName !== undefined) {
      sets.push("full_name = ?");
      params.push(input.fullName.trim());
    }
    if (input.role !== undefined) {
      sets.push("role = ?");
      params.push(input.role);
    }
    if (input.isActive !== undefined) {
      sets.push("is_active = ?");
      params.push(input.isActive ? 1 : 0);
    }
    if (input.pin !== undefined) {
      sets.push("pin_hash = ?");
      params.push(hashPin(input.pin));
    }
    sets.push("updated_at = ?");
    params.push(now);
    params.push(input.id);
    db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...params);

    const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(input.id) as any;
    const entity = mapRow(row);
    enqueueSyncWrite(db, {
      localUuid: randomUUID(),
      entityType: "users",
      operation: "update",
      payload: { ...entity, pinHash: row.pin_hash },
    });
    writeAuditLog(db, {
      entityType: "users",
      entityId: input.id,
      action: "update",
      beforeValue: before,
      afterValue: entity,
      performedById: performedByUserId,
    });
    return entity;
  });
  return tx();
}
