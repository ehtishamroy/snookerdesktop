import { create } from "zustand";
import { api } from "../api";
import type { IdleAlertItem } from "../api";

interface AlertsState {
  alerts: IdleAlertItem[];
  acknowledged: Set<number>;
  init(): () => void;
  acknowledge(gameId: number): void;
  /** Alerts still worth showing: idle AND not yet dismissed by the receptionist. */
  visibleAlerts(): IdleAlertItem[];
}

export const useAlertsStore = create<AlertsState>((set, get) => ({
  alerts: [],
  acknowledged: new Set<number>(),

  init() {
    return api.alerts.onIdleAlert((alerts) => {
      // Once a game is no longer idle (ended, or simply no longer flagged),
      // drop its id from the acknowledged set so a *future* idle episode on
      // the same table/game type isn't silently pre-suppressed.
      const stillOpenIds = new Set(alerts.map((a) => a.gameId));
      const prunedAck = new Set([...get().acknowledged].filter((id) => stillOpenIds.has(id)));
      set({ alerts, acknowledged: prunedAck });
    });
  },

  acknowledge(gameId) {
    set((s) => ({ acknowledged: new Set(s.acknowledged).add(gameId) }));
  },

  visibleAlerts() {
    const { alerts, acknowledged } = get();
    return alerts.filter((a) => !acknowledged.has(a.gameId));
  },
}));
