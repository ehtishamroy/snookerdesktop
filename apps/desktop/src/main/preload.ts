/**
 * The ONLY bridge between the sandboxed renderer and the main process.
 * Exposes `window.api`, typed exactly as `DesktopApi` (src/ipc/contract.ts),
 * via contextBridge — the renderer never gets direct access to
 * ipcRenderer/Node/electron APIs, satisfying Electron's contextIsolation
 * security model while still giving the UI a fully-typed, promise-based
 * surface for every local DB operation and sync/alert event stream.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../ipc/contract";
import type { DesktopApi, IdleAlertItem, SyncStatus } from "../ipc/contract";

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: DesktopApi = {
  auth: {
    login: (input) => invoke(IPC_CHANNELS.authLogin, input),
    getSession: () => invoke(IPC_CHANNELS.authGetSession),
  },
  shifts: {
    previewZReport: (input) => invoke(IPC_CHANNELS.shiftPreviewZReport, input),
    close: (input) => invoke(IPC_CHANNELS.shiftClose, input),
  },
  tables: {
    getTiles: () => invoke(IPC_CHANNELS.tablesGetTiles),
    getDashboardSummary: () => invoke(IPC_CHANNELS.tablesGetDashboardSummary),
    list: () => invoke(IPC_CHANNELS.tablesList),
    setActive: (input) => invoke(IPC_CHANNELS.tablesSetActive, input),
    getHistory: (tableId) => invoke(IPC_CHANNELS.tablesGetHistory, tableId),
    getVacancyHistory: (tableId) => invoke(IPC_CHANNELS.tablesGetVacancyHistory, tableId),
    getAllVacancyHistory: () => invoke(IPC_CHANNELS.tablesGetAllVacancyHistory),
  },
  gameTypes: {
    list: (tableType) => invoke(IPC_CHANNELS.gameTypesList, tableType),
  },
  pricingRules: {
    getActive: (tableType) => invoke(IPC_CHANNELS.pricingRulesGetActive, tableType),
    getHistory: (filter) => invoke(IPC_CHANNELS.pricingRulesGetHistory, filter),
    create: (input) => invoke(IPC_CHANNELS.pricingRulesCreate, input),
  },
  customers: {
    search: (query) => invoke(IPC_CHANNELS.customersSearch, query),
    create: (input) => invoke(IPC_CHANNELS.customersCreate, input),
    createNishani: (input) => invoke(IPC_CHANNELS.customersCreateNishani, input),
    merge: (input) => invoke(IPC_CHANNELS.customersMerge, input),
    getLedger: (customerId) => invoke(IPC_CHANNELS.customersGetLedger, customerId),
    getLoanLedger: () => invoke(IPC_CHANNELS.customersGetLoanLedger),
  },
  games: {
    start: (input) => invoke(IPC_CHANNELS.gamesStart, input),
    end: (input) => invoke(IPC_CHANNELS.gamesEnd, input),
    update: (input) => invoke(IPC_CHANNELS.gamesUpdate, input),
    reverse: (input) => invoke(IPC_CHANNELS.gamesReverse, input),
    list: (filter) => invoke(IPC_CHANNELS.gamesList, filter),
  },
  payments: {
    settle: (input) => invoke(IPC_CHANNELS.paymentsSettle, input),
  },
  collateral: {
    add: (input) => invoke(IPC_CHANNELS.collateralAdd, input),
    return: (input) => invoke(IPC_CHANNELS.collateralReturn, input),
  },
  expenses: {
    create: (input) => invoke(IPC_CHANNELS.expensesCreate, input),
    update: (input) => invoke(IPC_CHANNELS.expensesUpdate, input),
    list: (filter) => invoke(IPC_CHANNELS.expensesList, filter),
  },
  reports: {
    getLocalSummary: () => invoke(IPC_CHANNELS.reportsGetLocalSummary),
    getAuditLog: (filter) => invoke(IPC_CHANNELS.reportsGetAuditLog, filter),
  },
  users: {
    list: () => invoke(IPC_CHANNELS.usersList),
    create: (input) => invoke(IPC_CHANNELS.usersCreate, input),
    update: (input) => invoke(IPC_CHANNELS.usersUpdate, input),
  },
  sync: {
    getStatus: () => invoke(IPC_CHANNELS.syncGetStatus),
    forcePush: () => invoke(IPC_CHANNELS.syncForcePush),
    onStatusChanged: (cb: (status: SyncStatus) => void) => {
      const listener = (_event: unknown, status: SyncStatus) => cb(status);
      ipcRenderer.on(IPC_CHANNELS.syncStatusChangedEvent, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.syncStatusChangedEvent, listener);
    },
  },
  alerts: {
    onIdleAlert: (cb: (alerts: IdleAlertItem[]) => void) => {
      const listener = (_event: unknown, alerts: IdleAlertItem[]) => cb(alerts);
      ipcRenderer.on(IPC_CHANNELS.alertsIdleEvent, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.alertsIdleEvent, listener);
    },
  },
  settings: {
    get: () => invoke(IPC_CHANNELS.settingsGet),
    update: (patch) => invoke(IPC_CHANNELS.settingsUpdate, patch),
    chooseBackupFolder: () => invoke(IPC_CHANNELS.settingsChooseBackupFolder),
  },
};

contextBridge.exposeInMainWorld("api", api);
