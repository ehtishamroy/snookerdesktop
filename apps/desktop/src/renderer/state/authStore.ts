import { create } from "zustand";
import { api } from "../api";
import type { AuthSession, ZReport } from "../api";

interface AuthState {
  session: AuthSession | null;
  isBusy: boolean;
  error: string | null;
  /** Set while the Logout/Close-Shift flow is showing the Z-report before the session actually ends. */
  pendingShiftClose: boolean;

  login(username: string, pin: string): Promise<void>;
  restoreSession(): Promise<void>;
  previewShiftClose(): Promise<ZReport>;
  confirmShiftClose(declaredCashAmount: number): Promise<ZReport>;
  clearError(): void;
  openPendingShiftClose(): void;
  cancelPendingShiftClose(): void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  isBusy: false,
  error: null,
  pendingShiftClose: false,

  async login(username, pin) {
    set({ isBusy: true, error: null });
    try {
      const session = await api.auth.login({ username, pin });
      set({ session, isBusy: false });
    } catch (err) {
      set({ isBusy: false, error: err instanceof Error ? err.message : "Login failed" });
      throw err;
    }
  },

  async restoreSession() {
    const session = await api.auth.getSession();
    if (session) set({ session });
  },

  openPendingShiftClose() {
    set({ pendingShiftClose: true });
  },
  cancelPendingShiftClose() {
    set({ pendingShiftClose: false });
  },

  async previewShiftClose() {
    const { session } = get();
    if (!session) throw new Error("No active session");
    return api.shifts.previewZReport({ shiftId: session.shift.id });
  },

  /**
   * Decision #5/#6: "Log Out" and "Close Shift" are the SAME action — both
   * flows call this after collecting declared cash, and it always ends the
   * session immediately afterward, regardless of which button was pressed.
   */
  async confirmShiftClose(declaredCashAmount) {
    const { session } = get();
    if (!session) throw new Error("No active session");
    const { zReport } = await api.shifts.close({
      shiftId: session.shift.id,
      declaredCashAmount,
      closedByUserId: session.user.id,
    });
    set({ session: null, pendingShiftClose: false });
    return zReport;
  },

  clearError() {
    set({ error: null });
  },
}));

export function useIsOwnerOrManager(): boolean {
  const role = useAuthStore((s) => s.session?.user.role);
  return role === "owner" || role === "manager";
}

export function useIsOwner(): boolean {
  const role = useAuthStore((s) => s.session?.user.role);
  return role === "owner";
}
