# Cloud Backend API Contract (apps/server)

Base URL: `http://localhost:4000/api` in development. All endpoints (except
`/auth/login`) require `Authorization: Bearer <jwt>`. The JWT payload carries
`{ userId, role, fullName, username }`.

Roles: `owner` > `manager` > `receptionist` (see docs/DECISIONS.md and the
spec's §6 permissions matrix — discounts have no approval gate per decision
#3, but everything else in §6 still applies: only `owner` edits pricing or
manages staff accounts; `receptionist` cannot view other staff's historical
totals or reverse others' entries; `manager` can).

All list endpoints accept `?from=<ISO date>&to=<ISO date>` where relevant for
date-range reports.

## Auth
- `POST /auth/login` `{ username, pin }` -> `{ token, user }`
- `POST /auth/logout` -> also force-closes the caller's open shift (see
  Shifts below) — logout and shift-close are the same action.

## Users (owner only for mutations)
- `GET /users`
- `POST /users` `{ fullName, username, role, pin }`
- `PATCH /users/:id` `{ fullName?, role?, isActive?, pin? }` (reset PIN)

## Tables
- `GET /tables` -> includes current status (occupied/vacant) + active game summary if occupied
- `PATCH /tables/:id` `{ isActive }` (owner only)

## Game Types
- `GET /game-types`

## Pricing Rules
- `GET /pricing-rules?activeOnly=true` — current effective rules
- `GET /pricing-rules/history?tableType=&gameTypeId=` — full version history
- `POST /pricing-rules` (owner only) `{ tableType, gameTypeId, price, durationMinutes }`
  — server closes the previous active rule (`effectiveTo = now()`) for that
  `(tableType, gameTypeId)` and inserts a new one with `effectiveFrom = now()`.
- Resolving the price for a game always means: the rule whose
  `effective_from <= game.start_time < COALESCE(effective_to, 'infinity')`.

## Customers
- `GET /customers?search=` — fuzzy/partial match, **excludes** `is_temporary=true`
  rows that were never merged (decision #17 — nishani should not surface in
  the normal autosuggest since nobody will recognize them by name later).
- `GET /customers/:id/ledger` — unsettled rounds + span + total owed (uses
  `packages/shared` `buildCustomerLedger`)
- `POST /customers` `{ displayName, phone?, notes? }`
- `POST /customers/nishani` `{ nishaniDescription }` -> creates `isTemporary=true` row
- `POST /customers/:id/merge` `{ intoCustomerId }` (owner/manager) — re-points
  all games/payments/collateral to `intoCustomerId`, sets
  `mergedIntoCustomerId`, keeps full history (never duplicates).
- `GET /customers/loan-ledger` — all customers with outstanding balances,
  sortable by amount (owner/manager view)

## Games (rounds)
- `POST /games` — create/start a game `{ localUuid, tableId, gameTypeId, startTime, loserCustomerId, winnerCustomerId?, ... }`
- `PATCH /games/:id` — edit or end a game (end time, price override, payment
  status, discount). Any edit writes an `audit_log` row with before/after and
  bumps `updated_at`; the row itself is updated in place (not append-only
  duplicated rows) but the audit trail preserves every prior version.
- `POST /games/:id/reverse` `{ reason }` — soft-delete: sets `reversed=true`,
  `reversedReason`, `reversedBy`, `reversedAt`; excluded from revenue totals
  but stays visible in Reversal/Edit History.
- `GET /games?tableId=&customerId=&from=&to=&paymentStatus=&reversed=false`

## Payments (settlement)
- `POST /payments` `{ customerId, amount, method, note?, gameIds[] }` — settles
  the given rounds (see `validateSettlement` in shared); supports partial
  settlement (subset of a customer's unsettled rounds).

## Collateral
- `POST /collateral-items` `{ gameId, customerId, itemDescription }`
- `POST /collateral-items/:id/return` `{}` — sets `returned=true`, `returnedAt`, `returnedByUserId`

## Table Status Log
- Managed server-side automatically whenever a game starts/ends (closes the
  prior vacancy window / opens a new one) — no direct client writes.
- `GET /reports/utilization?tableId=&from=&to=` -> per-table vacant windows +
  utilization % (uses `computeUtilization`)

## Shifts (cash reconciliation + staff attendance)
- `POST /shifts/open` -> opens (or returns existing open) shift for the caller
- `POST /shifts/:id/close` `{ declaredCashAmount }` -> computes the Z-report
  (`buildZReport`), locks the shift's entries, and the caller is logged out
  by the client immediately after. Logout (`/auth/logout`) does the same
  close-with-whatever-declared-amount-is-given flow if a shift is still open.
- `GET /shifts/:id/z-report`
- `GET /shifts?userId=&from=&to=` — for staff performance / attendance report

## Expenses
- `POST /expenses` `{ category, amount, method, note? }`
- `GET /expenses?from=&to=&shiftId=`

## Reports (owner view)
- `GET /reports/revenue?tableId=&from=&to=` — per-table/overall revenue by
  payment status and payment method
- `GET /reports/staff-performance?from=&to=`
- `GET /reports/audit-log?entityType=&entityId=&performedBy=&from=&to=`
- `GET /reports/tricked?from=&to=`
- All report endpoints accept `&format=csv` to stream a CSV instead of JSON.

## Sync (desktop <-> cloud)
- `POST /sync/push` `{ operations: [{ localUuid, entityType, operation, payload }] }`
  -> idempotent on `localUuid`; returns per-operation `{ localUuid, status: 'applied'|'duplicate'|'error', serverId? }`
- `GET /sync/pull?since=<ISO timestamp>` -> all rows changed after `since`
  across pricing_rules, tables, game_types, customers (non-nishani), and any
  of the caller's own shift/game data — used to hydrate a desktop app that
  was offline when the owner changed prices, etc.
- Conflict resolution: last-write-wins on `updated_at`; the losing version is
  still written to `audit_log` as a superseded snapshot, never discarded.

## Background jobs
- `apps/server/src/jobs/purgeNishani.ts` — runs periodically; deletes any
  `customers` row with `isTemporary=true`, `mergedIntoCustomerId IS NULL`,
  and zero rows in `games` with `paymentStatus IN ('pending','loan','collateral')`.
- `apps/server/src/jobs/idleAlertScan.ts` — runs periodically; finds games
  with `endTime IS NULL` and elapsed time past `checkIdleAlert`'s threshold,
  surfaced to the owner dashboard and desktop apps as a live alert.
