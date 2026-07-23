import { create } from "zustand";
import { api } from "../api";
import type { DashboardSummary, TableTileView } from "../api";

interface TablesState {
  tiles: TableTileView[];
  summary: DashboardSummary | null;
  loading: boolean;
  refresh(): Promise<void>;
  startPolling(): () => void;
}

const POLL_MS = 4000;

export const useTablesStore = create<TablesState>((set, get) => ({
  tiles: [],
  summary: null,
  loading: false,

  async refresh() {
    set({ loading: get().tiles.length === 0 });
    const [tiles, summary] = await Promise.all([api.tables.getTiles(), api.tables.getDashboardSummary()]);
    set({ tiles, summary, loading: false });
  },

  startPolling() {
    void get().refresh();
    const interval = setInterval(() => void get().refresh(), POLL_MS);
    return () => clearInterval(interval);
  },
}));
