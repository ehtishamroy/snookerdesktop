/**
 * Registers every ipcMain.handle() call the preload bridge exposes as
 * `window.api`. Each handler is a thin wrapper around a repository function —
 * all the actual business logic (transactions, sync_queue writes, audit
 * logging) lives in src/main/db/repositories/*, not here. This file's only
 * extra responsibility is role enforcement (defense-in-depth: the renderer
 * UI already hides owner/manager-only actions from a receptionist, but a
 * receptionist's IPC calls must not be able to perform them even by forging
 * a request, matching docs/API_CONTRACT.md's role notes).
 */
import { dialog, ipcMain } from "electron";
import type { Role, TableType } from "@snooker/shared";
import { IPC_CHANNELS } from "../../ipc/contract";
import type {
  AddCollateralInput,
  AppSettings,
  AuthSession,
  CreateCustomerInput,
  CreateExpenseInput,
  CreateNishaniInput,
  CreatePricingRuleInput,
  CreateUserInput,
  EndGameInput,
  ExpenseListFilter,
  GameListFilter,
  LoginInput,
  MergeCustomersInput,
  PricingRuleHistoryFilter,
  ReturnCollateralInput,
  ReverseGameInput,
  SetTableActiveInput,
  SettleInput,
  ShiftCloseInput,
  ShiftClosePreviewInput,
  StartGameInput,
  UpdateGameInput,
  UpdateUserInput,
} from "../../ipc/contract";

import * as usersRepo from "../db/repositories/usersRepo";
import * as shiftsRepo from "../db/repositories/shiftsRepo";
import * as tablesRepo from "../db/repositories/tablesRepo";
import * as gameTypesRepo from "../db/repositories/gameTypesRepo";
import * as pricingRulesRepo from "../db/repositories/pricingRulesRepo";
import * as customersRepo from "../db/repositories/customersRepo";
import * as gamesRepo from "../db/repositories/gamesRepo";
import * as paymentsRepo from "../db/repositories/paymentsRepo";
import * as collateralRepo from "../db/repositories/collateralRepo";
import * as expensesRepo from "../db/repositories/expensesRepo";
import * as auditLogRepo from "../db/repositories/auditLogRepo";
import * as reportsRepo from "../db/repositories/reportsRepo";
import { getDb } from "../db/client";
import { getCurrentSession, setCurrentSession, clearCurrentSession } from "../session";
import { getSettings, updateSettings } from "../config";
import type { SyncEngine } from "../sync/syncEngine";

class ForbiddenError extends Error {}

function requireRole(userId: number, allowed: Role[]): void {
  const user = usersRepo.getUserById(userId);
  if (!allowed.includes(user.role)) {
    throw new ForbiddenError(`Role '${user.role}' is not permitted to perform this action`);
  }
}

export function registerIpcHandlers(syncEngine: SyncEngine): void {
  // ---- Auth / session -----------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.authLogin, (_event, input: LoginInput): AuthSession => {
    const user = usersRepo.verifyLogin(input.username, input.pin);
    if (!user) throw new Error("Incorrect username or PIN");
    // Shift open = login (decision #5/#12); reuses an already-open shift if
    // one exists (crash-recovery edge case handled inside the repo).
    const shift = shiftsRepo.openShiftForUser(user.id);
    const session: AuthSession = { user, shift };
    setCurrentSession(session);
    return session;
  });

  ipcMain.handle(IPC_CHANNELS.authGetSession, (): AuthSession | null => getCurrentSession());

  // ---- Shifts (cash reconciliation + logout) ------------------------------
  ipcMain.handle(IPC_CHANNELS.shiftPreviewZReport, (_event, input: ShiftClosePreviewInput) =>
    shiftsRepo.previewZReport(input.shiftId)
  );

  ipcMain.handle(IPC_CHANNELS.shiftClose, (_event, input: ShiftCloseInput) => {
    // Both "Log Out" and "Close Shift" converge on this single handler
    // (decision #5): closing always ends the session immediately after.
    const { zReport } = shiftsRepo.closeShift(input);
    clearCurrentSession();
    return { zReport };
  });

  // ---- Tables --------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.tablesGetTiles, () => gamesRepo.getTableTiles());
  ipcMain.handle(IPC_CHANNELS.tablesGetDashboardSummary, () => gamesRepo.getDashboardSummary());
  ipcMain.handle(IPC_CHANNELS.tablesList, () => tablesRepo.listTables());
  ipcMain.handle(IPC_CHANNELS.tablesSetActive, (_event, input: SetTableActiveInput) => {
    requireRole(input.performedByUserId, ["owner"]);
    return tablesRepo.setTableActive(input);
  });

  // ---- Game types / pricing --------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.gameTypesList, (_event, tableType?: TableType) =>
    tableType ? gameTypesRepo.listGameTypesForTableType(tableType) : gameTypesRepo.listGameTypes()
  );
  ipcMain.handle(IPC_CHANNELS.pricingRulesGetActive, (_event, tableType?: TableType) =>
    pricingRulesRepo.getActivePricingRules(tableType)
  );
  ipcMain.handle(IPC_CHANNELS.pricingRulesGetHistory, (_event, filter: PricingRuleHistoryFilter) =>
    pricingRulesRepo.getPricingRuleHistory(filter ?? {})
  );
  ipcMain.handle(IPC_CHANNELS.pricingRulesCreate, (_event, input: CreatePricingRuleInput) => {
    requireRole(input.createdByUserId, ["owner"]);
    return pricingRulesRepo.createPricingRule(input);
  });

  // ---- Customers -------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.customersSearch, (_event, query: string) => customersRepo.searchCustomers(query));
  ipcMain.handle(IPC_CHANNELS.customersCreate, (_event, input: CreateCustomerInput) => customersRepo.createCustomer(input));
  ipcMain.handle(IPC_CHANNELS.customersCreateNishani, (_event, input: CreateNishaniInput) =>
    customersRepo.createNishaniCustomer(input)
  );
  ipcMain.handle(IPC_CHANNELS.customersMerge, (_event, input: MergeCustomersInput) => {
    requireRole(input.performedByUserId, ["owner", "manager"]);
    customersRepo.mergeCustomers(input);
  });
  ipcMain.handle(IPC_CHANNELS.customersGetLedger, (_event, customerId: number) => customersRepo.getCustomerLedger(customerId));
  ipcMain.handle(IPC_CHANNELS.customersGetLoanLedger, () => customersRepo.getLoanLedger());

  // ---- Games -------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.gamesStart, (_event, input: StartGameInput) => gamesRepo.startGame(input));
  ipcMain.handle(IPC_CHANNELS.gamesEnd, (_event, input: EndGameInput) => gamesRepo.endGame(input));
  ipcMain.handle(IPC_CHANNELS.gamesUpdate, (_event, input: UpdateGameInput) => gamesRepo.updateGame(input));
  ipcMain.handle(IPC_CHANNELS.gamesReverse, (_event, input: ReverseGameInput) => gamesRepo.reverseGame(input));
  ipcMain.handle(IPC_CHANNELS.gamesList, (_event, filter: GameListFilter) => gamesRepo.listGames(filter ?? {}));

  // ---- Payments / collateral / expenses ------------------------------------------
  ipcMain.handle(IPC_CHANNELS.paymentsSettle, (_event, input: SettleInput) => paymentsRepo.settle(input));
  ipcMain.handle(IPC_CHANNELS.collateralAdd, (_event, input: AddCollateralInput) => collateralRepo.addCollateral(input));
  ipcMain.handle(IPC_CHANNELS.collateralReturn, (_event, input: ReturnCollateralInput) => collateralRepo.returnCollateral(input));
  ipcMain.handle(IPC_CHANNELS.expensesCreate, (_event, input: CreateExpenseInput) => expensesRepo.createExpense(input));
  ipcMain.handle(IPC_CHANNELS.expensesList, (_event, filter: ExpenseListFilter) => expensesRepo.listExpenses(filter ?? {}));

  // ---- Reports / audit -----------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.reportsGetLocalSummary, () => reportsRepo.getLocalSummary());
  ipcMain.handle(
    IPC_CHANNELS.reportsGetAuditLog,
    (_event, filter?: { entityType?: string; entityId?: number; from?: string; to?: string }) =>
      auditLogRepo.getAuditLog(getDb(), filter ?? {})
  );

  // ---- Users (owner only for mutations, per API_CONTRACT.md) ------------------
  ipcMain.handle(IPC_CHANNELS.usersList, () => usersRepo.listUsers());
  ipcMain.handle(IPC_CHANNELS.usersCreate, (_event, input: CreateUserInput) => {
    requireRole(input.performedByUserId, ["owner"]);
    return usersRepo.createUser(input);
  });
  ipcMain.handle(IPC_CHANNELS.usersUpdate, (_event, input: UpdateUserInput) => {
    requireRole(input.performedByUserId, ["owner"]);
    return usersRepo.updateUser(input, input.performedByUserId);
  });

  // ---- Sync ------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.syncGetStatus, () => syncEngine.getStatus());
  ipcMain.handle(IPC_CHANNELS.syncForcePush, () => syncEngine.runOnce());

  // ---- Settings ----------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => getSettings());
  ipcMain.handle(IPC_CHANNELS.settingsUpdate, (_event, patch?: Partial<AppSettings>) => updateSettings(patch ?? {}));
  ipcMain.handle(IPC_CHANNELS.settingsChooseBackupFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  });
}
