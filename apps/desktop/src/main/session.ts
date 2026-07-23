/**
 * In-memory "who's currently signed in at this counter" state for the main
 * process. A single desktop install is used by one receptionist at a time
 * (spec §11 Multi-device: "multiple receptionist PCs run simultaneously",
 * i.e. multiple *installs*, not multiple concurrent logins on one install),
 * so a single current-session slot is sufficient and lets a handful of
 * read-only IPC calls (e.g. the Reports screen's "current shift" preview)
 * avoid having to thread ids through every call. It intentionally does NOT
 * replace explicit `performedByUserId`/`shiftId` parameters on mutating
 * calls — those are still passed explicitly from the renderer's authStore
 * so every write is unambiguously attributed even if this in-memory slot is
 * ever wrong (e.g. after a main-process crash-and-restart mid-shift).
 */
import type { AuthSession } from "../ipc/contract";

let currentSession: AuthSession | null = null;

export function getCurrentSession(): AuthSession | null {
  return currentSession;
}

export function setCurrentSession(session: AuthSession): void {
  currentSession = session;
}

export function clearCurrentSession(): void {
  currentSession = null;
}
