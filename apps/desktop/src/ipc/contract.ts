/**
 * The single typed contract between the Electron main process (implements
 * every handler in src/main/ipc/handlers.ts), the preload bridge
 * (src/main/preload.ts, which exposes `window.api` matching `DesktopApi`
 * exactly), and the renderer (src/renderer/api, which calls `window.api`).
 *
 * This file has ZERO Node/Electron/DOM-specific imports so it can be
 * included from both tsconfig.node.json and tsconfig.web.json without
 * pulling in the wrong global environment.
 */
import type {
  AuditLogEntity,
  CollateralItemEntity,
  CustomerEntity,
  ExpenseEntity,
  GameEntity,
  GameTypeCode,
  GameTypeEntity,
  PaymentEntity,
  PaymentMethod,
  PaymentStatus,
  PricingRuleEntity,
  Role,
  ShiftEntity,
  TableEntity,
  TableType,
  UserEntity,
  ZReport,
} from "@snooker/shared";

// ---------------------------------------------------------------------------
// View models (desktop-specific shapes built from several tables at once —
// these are what the UI actually renders, distinct from the raw entities).
// ---------------------------------------------------------------------------

export interface AuthSession {
  user: UserEntity;
  shift: ShiftEntity;
}

export interface CustomerSuggestion extends CustomerEntity {
  /** Sum of priceFinal across this customer's unsettled (pending/loan/collateral/tricked) rounds. */
  owedAmount: number;
}

export interface LoanLedgerRow {
  customerId: number;
  displayName: string;
  isTemporary: boolean;
  nishaniDescription: string | null;
  totalOwed: number;
  unsettledRoundCount: number;
  oldestUnpaidAt: string;
}

export interface LedgerGameView {
  gameId: number;
  tableNumber: number;
  tableLabel: string;
  gameTypeName: string;
  startTime: string;
  endTime: string;
  durationBilledMinutes: number;
  priceFinal: number;
  paymentStatus: PaymentStatus;
}

export interface CustomerLedgerView {
  customerId: number;
  displayName: string;
  isTemporary: boolean;
  unsettledGames: LedgerGameView[];
  totalOwed: number;
  spanStart: string | null;
  spanEnd: string | null;
  spanMinutes: number;
}

export interface CurrentGameView {
  gameId: number;
  gameTypeId: number;
  gameTypeName: string;
  gameTypeCode: GameTypeCode;
  startTime: string;
  loserCustomerId: number | null;
  loserName: string | null;
  winnerCustomerId: number | null;
  winnerName: string | null;
  /** The block price/duration resolved at this round's START time (decision #2) — not necessarily today's active price. */
  blockPrice: number;
  blockDurationMinutes: number;
  elapsedMinutes: number;
  isIdleAlert: boolean;
}

export interface TableTileView {
  table: TableEntity;
  status: "occupied" | "vacant";
  currentGame: CurrentGameView | null;
  todayEarnings: number;
}

export interface DashboardSummary {
  totalRevenueToday: number;
  pendingDuesTotal: number;
  occupiedCount: number;
  vacantCount: number;
}

export interface IdleAlertItem {
  gameId: number;
  tableId: number;
  tableNumber: number;
  tableLabel: string;
  gameTypeName: string;
  loserName: string | null;
  minutesElapsed: number;
  thresholdMinutes: number;
}

export interface TableHistoryItemView {
  gameId: number;
  gameTypeName: string;
  startTime: string;
  endTime: string | null;
  durationBilledMinutes: number | null;
  priceFinal: number;
  paymentStatus: PaymentStatus;
  loserName: string | null;
  winnerName: string | null;
  reversed: boolean;
}

export interface TableHistoryView {
  items: TableHistoryItemView[];
  totalGamesToday: number;
  totalGamesAllTime: number;
}

export interface TableVacancyWindowView {
  from: string;
  to: string;
  durationMinutes: number;
}

export interface TableVacancyHistoryView {
  windows: TableVacancyWindowView[];
  totalVacantMinutes: number;
  totalOccupiedMinutes: number;
  utilizationPercent: number;
}

export interface TableVacancyHistoryRow extends TableVacancyHistoryView {
  tableId: number;
  tableNumber: number;
  label: string;
}

export interface PerTableRevenueRow {
  tableId: number;
  tableNumber: number;
  label: string;
  revenueToday: number;
  roundsToday: number;
}

export interface LocalReportsSummary {
  date: string;
  totalRevenueToday: number;
  pendingDuesTotal: number;
  loanTotal: number;
  discountsGivenToday: number;
  trickedCountToday: number;
  collateralOpenCount: number;
  perTableRevenue: PerTableRevenueRow[];
  currentShiftZReportPreview: ZReport;
}

export type SyncState = "synced" | "syncing" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface AppSettings {
  syncServerUrl: string;
  backupFolderPath: string | null;
  backupIntervalHours: number;
  lastBackupAt: string | null;
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

export interface LoginInput {
  username: string;
  pin: string;
}

export interface ShiftClosePreviewInput {
  shiftId: number;
}

export interface ShiftCloseInput {
  shiftId: number;
  declaredCashAmount: number;
  closedByUserId: number;
}

export interface SetTableActiveInput {
  tableId: number;
  isActive: boolean;
  performedByUserId: number;
}

export interface CreatePricingRuleInput {
  tableType: TableType;
  gameTypeId: number;
  price: number;
  durationMinutes: number;
  createdByUserId: number;
}

export interface PricingRuleHistoryFilter {
  tableType?: TableType;
  gameTypeId?: number;
}

export interface CreateCustomerInput {
  displayName: string;
  phone?: string;
  notes?: string;
}

export interface CreateNishaniInput {
  nishaniDescription: string;
}

export interface MergeCustomersInput {
  fromCustomerId: number;
  intoCustomerId: number;
  performedByUserId: number;
}

export interface StartGameInput {
  tableId: number;
  gameTypeId: number;
  startTime: string;
  loserCustomerId?: number | null;
  winnerCustomerId?: number | null;
  createdByUserId: number;
  shiftId: number;
}

export interface EndGameInput {
  gameId: number;
  endTime: string;
  priceOverride?: number | null;
  paymentStatus: PaymentStatus;
  discountAmount?: number;
  discountPercent?: number;
  discountReason?: string;
  discountByUserId?: number;
  paymentMethod?: PaymentMethod;
  collateralDescription?: string;
  /** Set (or change) who the round is attributed to as part of ending it, if it wasn't set already during the round. */
  loserCustomerId?: number | null;
  winnerCustomerId?: number | null;
  performedByUserId: number;
  shiftId: number;
}

export interface UpdateGamePatch {
  startTime?: string;
  endTime?: string;
  priceFinal?: number;
  discountAmount?: number;
  discountReason?: string;
  paymentStatus?: PaymentStatus;
  winnerCustomerId?: number | null;
  loserCustomerId?: number;
}

export interface UpdateGameInput {
  gameId: number;
  patch: UpdateGamePatch;
  performedByUserId: number;
  reason: string;
}

export interface ReverseGameInput {
  gameId: number;
  reason: string;
  performedByUserId: number;
}

export interface GameListFilter {
  tableId?: number;
  customerId?: number;
  from?: string;
  to?: string;
  paymentStatus?: PaymentStatus;
  reversed?: boolean;
}

export interface SettleInput {
  customerId: number;
  selectedGameIds: number[];
  method: PaymentMethod;
  note?: string;
  /** Unrestricted, like the per-round discount at End Game (decision #3) — reduces what's collected below the selected rounds' summed price. */
  discountAmount?: number;
  discountReason?: string;
  collectedByUserId: number;
  shiftId: number;
}

export interface AddCollateralInput {
  gameId: number;
  customerId: number;
  itemDescription: string;
  heldByUserId: number;
}

export interface ReturnCollateralInput {
  collateralId: number;
  returnedByUserId: number;
}

export interface CreateExpenseInput {
  category: string;
  amount: number;
  method: PaymentMethod;
  note?: string;
  recordedByUserId: number;
  shiftId: number;
}

export interface ExpenseListFilter {
  from?: string;
  to?: string;
  shiftId?: number;
}

export interface UpdateExpensePatch {
  category?: string;
  amount?: number;
  method?: PaymentMethod;
  note?: string;
}

export interface UpdateExpenseInput {
  expenseId: number;
  patch: UpdateExpensePatch;
  performedByUserId: number;
}

export interface CreateUserInput {
  fullName: string;
  username: string;
  role: Role;
  pin: string;
  performedByUserId: number;
}

export interface UpdateUserInput {
  id: number;
  fullName?: string;
  role?: Role;
  isActive?: boolean;
  pin?: string;
  performedByUserId: number;
}

// ---------------------------------------------------------------------------
// The full typed surface exposed as `window.api` by the preload script.
// ---------------------------------------------------------------------------

export interface DesktopApi {
  auth: {
    login(input: LoginInput): Promise<AuthSession>;
    getSession(): Promise<AuthSession | null>;
  };
  shifts: {
    previewZReport(input: ShiftClosePreviewInput): Promise<ZReport>;
    close(input: ShiftCloseInput): Promise<{ zReport: ZReport }>;
  };
  tables: {
    getTiles(): Promise<TableTileView[]>;
    getDashboardSummary(): Promise<DashboardSummary>;
    list(): Promise<TableEntity[]>;
    setActive(input: SetTableActiveInput): Promise<TableEntity>;
    getHistory(tableId: number): Promise<TableHistoryView>;
    getVacancyHistory(tableId: number): Promise<TableVacancyHistoryView>;
    getAllVacancyHistory(): Promise<TableVacancyHistoryRow[]>;
  };
  gameTypes: {
    list(tableType?: TableType): Promise<GameTypeEntity[]>;
  };
  pricingRules: {
    getActive(tableType?: TableType): Promise<PricingRuleEntity[]>;
    getHistory(filter: PricingRuleHistoryFilter): Promise<PricingRuleEntity[]>;
    create(input: CreatePricingRuleInput): Promise<PricingRuleEntity>;
  };
  customers: {
    search(query: string): Promise<CustomerSuggestion[]>;
    create(input: CreateCustomerInput): Promise<CustomerEntity>;
    createNishani(input: CreateNishaniInput): Promise<CustomerEntity>;
    merge(input: MergeCustomersInput): Promise<void>;
    getLedger(customerId: number): Promise<CustomerLedgerView>;
    getLoanLedger(): Promise<LoanLedgerRow[]>;
  };
  games: {
    start(input: StartGameInput): Promise<GameEntity>;
    end(input: EndGameInput): Promise<GameEntity>;
    update(input: UpdateGameInput): Promise<GameEntity>;
    reverse(input: ReverseGameInput): Promise<GameEntity>;
    list(filter: GameListFilter): Promise<GameEntity[]>;
  };
  payments: {
    settle(input: SettleInput): Promise<PaymentEntity>;
  };
  collateral: {
    add(input: AddCollateralInput): Promise<CollateralItemEntity>;
    return(input: ReturnCollateralInput): Promise<CollateralItemEntity>;
  };
  expenses: {
    create(input: CreateExpenseInput): Promise<ExpenseEntity>;
    update(input: UpdateExpenseInput): Promise<ExpenseEntity>;
    list(filter: ExpenseListFilter): Promise<ExpenseEntity[]>;
  };
  reports: {
    getLocalSummary(): Promise<LocalReportsSummary>;
    getAuditLog(filter: { entityType?: string; entityId?: number; from?: string; to?: string }): Promise<AuditLogEntity[]>;
  };
  users: {
    list(): Promise<UserEntity[]>;
    create(input: CreateUserInput): Promise<UserEntity>;
    update(input: UpdateUserInput): Promise<UserEntity>;
  };
  sync: {
    getStatus(): Promise<SyncStatus>;
    forcePush(): Promise<void>;
    onStatusChanged(cb: (status: SyncStatus) => void): () => void;
  };
  alerts: {
    onIdleAlert(cb: (alerts: IdleAlertItem[]) => void): () => void;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    chooseBackupFolder(): Promise<string | null>;
  };
}

/** IPC channel names, grouped identically to DesktopApi, kept in one place so
 * main/ipc handlers.ts and main/preload.ts can never drift out of sync. */
export const IPC_CHANNELS = {
  authLogin: "auth:login",
  authGetSession: "auth:getSession",
  shiftPreviewZReport: "shift:previewZReport",
  shiftClose: "shift:close",
  tablesGetTiles: "tables:getTiles",
  tablesGetDashboardSummary: "tables:getDashboardSummary",
  tablesList: "tables:list",
  tablesSetActive: "tables:setActive",
  tablesGetHistory: "tables:getHistory",
  tablesGetVacancyHistory: "tables:getVacancyHistory",
  tablesGetAllVacancyHistory: "tables:getAllVacancyHistory",
  gameTypesList: "gameTypes:list",
  pricingRulesGetActive: "pricingRules:getActive",
  pricingRulesGetHistory: "pricingRules:getHistory",
  pricingRulesCreate: "pricingRules:create",
  customersSearch: "customers:search",
  customersCreate: "customers:create",
  customersCreateNishani: "customers:createNishani",
  customersMerge: "customers:merge",
  customersGetLedger: "customers:getLedger",
  customersGetLoanLedger: "customers:getLoanLedger",
  gamesStart: "games:start",
  gamesEnd: "games:end",
  gamesUpdate: "games:update",
  gamesReverse: "games:reverse",
  gamesList: "games:list",
  paymentsSettle: "payments:settle",
  collateralAdd: "collateral:add",
  collateralReturn: "collateral:return",
  expensesCreate: "expenses:create",
  expensesUpdate: "expenses:update",
  expensesList: "expenses:list",
  reportsGetLocalSummary: "reports:getLocalSummary",
  reportsGetAuditLog: "reports:getAuditLog",
  usersList: "users:list",
  usersCreate: "users:create",
  usersUpdate: "users:update",
  syncGetStatus: "sync:getStatus",
  syncForcePush: "sync:forcePush",
  syncStatusChangedEvent: "sync:statusChanged",
  alertsIdleEvent: "alerts:idle",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  settingsChooseBackupFolder: "settings:chooseBackupFolder",
} as const;
