import { create } from "zustand";
import { api } from "../api";
import type { SyncStatus } from "../api";

interface SyncStatusState {
  status: SyncStatus;
  init(): () => void;
  forcePush(): Promise<void>;
}

export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  status: { state: "offline", pendingCount: 0, lastSyncedAt: null, lastError: null },

  init() {
    void api.sync.getStatus().then((status) => set({ status }));
    return api.sync.onStatusChanged((status) => set({ status }));
  },

  async forcePush() {
    await api.sync.forcePush();
    const status = await api.sync.getStatus();
    set({ status });
  },
}));
