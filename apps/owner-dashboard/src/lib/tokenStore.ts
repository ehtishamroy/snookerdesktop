import type { Role } from "@snooker/shared";

/**
 * Single place that owns how the session (JWT + user) is persisted.
 *
 * Tradeoff (documented per task spec): we store the JWT in `localStorage`.
 * This is simple, works fine for a PWA that only reads non-payment-card data,
 * and avoids needing a same-site backend-for-frontend to set httpOnly
 * cookies. The real tradeoff is XSS exposure — any injected script can read
 * `localStorage` and steal the token, whereas an httpOnly cookie would not
 * be readable from JS at all. For a hardened production deploy, prefer:
 *   - the server sets an httpOnly, Secure, SameSite=Strict cookie on login,
 *   - this dashboard is served from the same site (or a BFF proxies /api),
 *   - CSRF protection (double-submit token) is added since cookies are
 *     sent automatically.
 * We call this out explicitly rather than silently picking the weaker
 * option: for a first cloud-connected build with a small trusted user base
 * (the owner + a couple of managers), localStorage keeps the client fully
 * static (no server-rendered auth) and easy to reason about.
 */

const STORAGE_KEY = "snooker_owner_dashboard_session_v1";

export interface StoredUser {
  id: number;
  fullName: string;
  username: string;
  role: Role;
  isActive: boolean;
}

export interface StoredSession {
  token: string;
  user: StoredUser;
}

type Listener = (session: StoredSession | null) => void;

const listeners = new Set<Listener>();

function isBrowser() {
  return typeof window !== "undefined";
}

export function getSession(): StoredSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

export function setSession(session: StoredSession) {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  listeners.forEach((l) => l(session));
}

export function clearSession() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((l) => l(null));
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
