# @snooker/server

Cloud backend for the Snooker Club Management System — Node.js + TypeScript +
Express + Prisma (PostgreSQL). Implements the full REST API described in
`/docs/API_CONTRACT.md`, enforcing the business rules decided in
`/docs/DECISIONS.md`, and importing all pricing/billing/ledger/Z-report/
idle-detection/utilization math from `@snooker/shared` rather than
reimplementing it.

## Setup

```bash
# from the repo root, or from apps/server — pnpm workspaces resolve either way
cp apps/server/.env.example apps/server/.env
# edit apps/server/.env with a real DATABASE_URL and a real JWT_SECRET

pnpm install                                  # (run once, from repo root)
pnpm --filter @snooker/server prisma:generate
pnpm --filter @snooker/server prisma:migrate  # creates the schema in your Postgres
pnpm --filter @snooker/server prisma:seed     # seeds tables/game types/pricing/owner user
pnpm --filter @snooker/server dev             # starts the API on PORT (default 4000)
```

The seed script prints the generated owner PIN to the console **once** —
capture it there; it's bcrypt-hashed in the database and cannot be
recovered afterward (reset it via `PATCH /users/:id` if lost).

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string used by Prisma and at runtime. |
| `JWT_SECRET` | yes | Signs/verifies auth JWTs. Use a long random value in production. |
| `JWT_EXPIRES_IN` | no (default `12h`) | Token lifetime. |
| `PORT` | no (default `4000`) | HTTP port. |
| `CORS_ORIGINS` | no (default `*`) | Comma-separated allowed origins (desktop app / owner-dashboard). |
| `NISHANI_PURGE_CRON` | no (default every 5 min) | node-cron schedule for the nishani purge job. |
| `IDLE_ALERT_SCAN_CRON` | no (default every 1 min) | node-cron schedule for the idle-alert scan job. |

See `.env.example` for a ready-to-copy template.

### Scripts

- `pnpm dev` — `tsx watch src/index.ts`, hot-reloading dev server.
- `pnpm build` — type-checks with `tsc --noEmit`, then bundles with esbuild
  into `dist/index.js` (see "Why esbuild for the build step" below).
- `pnpm start` — `node dist/index.js` (run `build` first).
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm test` — runs the unit test suite (`vitest run`) against an
  in-memory fake Prisma; no database required (see "Testing" below).
- `pnpm prisma:generate` / `prisma:migrate` / `prisma:seed` / `prisma:studio`.

### Why esbuild for the build step

`@snooker/shared` intentionally ships no compiled output — its
`package.json` points `main`/`types` straight at `src/index.ts` so both this
server and the desktop app's bundler consume exactly one copy of the shared
business logic. `tsx` (used by `pnpm dev`) transpiles that workspace-linked
TS source on the fly, but a bare `tsc` emit followed by plain
`node dist/index.js` cannot `require("@snooker/shared")` at runtime, since
`tsc` never touches files outside its own `rootDir`. `pnpm build` therefore
runs `tsc --noEmit` for full type-checking (this is what surfaces real type
errors) and then uses esbuild (`esbuild.config.mjs`) to bundle
`src/index.ts` into a single `dist/index.js`, inlining + transpiling
`@snooker/shared`'s source exactly like `tsx` does for dev, while leaving
every published npm dependency external (loaded normally from
`node_modules` at runtime). This produces a `dist/index.js` that a plain
`node dist/index.js` can actually run, without ever modifying
`packages/shared`.

## Testing

`pnpm test` runs the full suite in `src/tests/` against
`src/tests/testDb.ts` — a small, purpose-built in-memory stand-in for
`PrismaClient`. This works because every function in `src/services/*`
(and `src/jobs/purgeNishani.ts`) takes its Prisma client as an **explicit
parameter** rather than importing the app's singleton — a deliberate
dependency-injection choice so the core business logic (pricing
resolution, overtime billing, discounts, settlement/partial settlement,
Z-report assembly, customer merge, nishani purge, idle detection, table
utilization) can be unit-tested against plain objects with no live
Postgres required. `src/tests/authFlow.test.ts` goes one level up and
exercises the real Express auth router + middleware + JWT code end-to-end
via `supertest`, with the same fake DB swapped in for the one route module
(`src/db.ts`) that does hold a module-level singleton.

`testDb.ts` is intentionally not a general Prisma re-implementation — it
only supports the where-clause shapes and methods this codebase actually
issues. It also mirrors two pieces of real Postgres behavior the tests
specifically rely on: `@updatedAt` bumping on every `update`, and the
`onDelete: SetNull` cascade wired up on `Game`/`Payment`/`CollateralItem`'s
customer relations (see the note in `prisma/schema.prisma`) when a
`Customer` row is deleted — this is exactly what the nishani purge tests
exercise.

### Running the full integration suite against a real Postgres

The unit suite above deliberately avoids needing a database at all. If you
want to additionally verify against a real Postgres (recommended before a
production deploy, and useful for catching anything the fake DB doesn't
model faithfully):

1. Point `DATABASE_URL` in `apps/server/.env` (or a separate `.env.test`)
   at a disposable Postgres database — e.g. a local `docker run -e
   POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16` or a throwaway
   Supabase/RDS instance. **Never point this at production.**
2. Run `pnpm --filter @snooker/server prisma:migrate` against it, then
   `pnpm --filter @snooker/server prisma:seed`.
3. Write additional `*.test.ts` files under `src/tests/` that import the
   real `prisma` singleton from `src/db.ts` instead of `testDb.ts`, and
   call the same service functions (`createGame`, `settlePayment`,
   `closeShift`, etc.) against it — since every service takes `prisma` as
   a parameter, no source changes are needed to point them at a real
   client instead of the fake one.
4. Truncate/reset relevant tables between test files (e.g. in a
   `beforeEach`/`afterEach` using `prisma.$transaction([...])` with
   `deleteMany()` calls in FK-safe order), since a real Postgres enforces
   the constraints the fake DB only partially mirrors.

## Role-based access — how the §6 matrix was applied

`docs/API_CONTRACT.md` and `docs/DECISIONS.md` establish the shape of the
matrix (owner > manager > receptionist; discounts have no approval gate;
only owner edits pricing/staff; receptionist is limited to their own shift
totals and can't reverse others' entries) but don't spell out every single
endpoint's exact gating. Where the wording didn't fully pin it down, this
build made the following calls (all in `src/routes/*` and
`src/auth/middleware.ts`):

- **Operational endpoints** (tables, game types, pricing lookups, customers,
  games list/create/edit, payments, collateral, expenses create) are open
  to any authenticated role — these are counter operations every shift
  needs, not analytics. `GET /games` is not row-filtered by role for the
  same reason: settling a customer's tab needs their full unsettled
  history regardless of which staff member rang each round in.
- **Mutation-role gates that ARE explicit in the contract** are enforced
  exactly as written: `POST/PATCH /users` and `PATCH /tables/:id` and
  `POST /pricing-rules` → owner only; `POST /customers/:id/merge` and
  `GET /customers/loan-ledger` → owner/manager.
- **Reversal**: a receptionist may reverse their own entries but not
  others'; owner/manager may reverse anyone's (`src/services/gameService.ts`
  `reverseGame`).
- **Editing** (`PATCH /games/:id`): the same self-vs-others split as
  reversal — a receptionist can only edit games they created.
- **Analytical/oversight reports** (`/reports/revenue`, `/reports/tricked`,
  `/reports/utilization`, `/reports/audit-log`, `GET /users`) are
  owner/manager only.
- **Self-scoped reports** (`/reports/staff-performance`, `GET /shifts`,
  `GET /shifts/:id/z-report`, `GET /expenses`): a receptionist is
  force-scoped to their own `userId` regardless of query params; owner/manager
  can see everyone (this is the literal implementation of "receptionist
  only sees their own shift totals").
- **Background job manual trigger** (`POST /jobs/purge-nishani`): owner
  only, per the contract's explicit wording.

## Design decisions made during this build (not fully pinned down upstream)

- **Table occupancy is derived, not stored.** A table is "occupied" iff it
  has a `Game` row with `endTime IS NULL` (see `src/routes/tables.ts`).
  `table_status_log` only ever stores `vacant` windows — closing one when a
  game starts, opening a new one when a game ends
  (`src/services/tableStatusService.ts`) — so there's no separately
  maintained status column that could drift out of sync with reality. The
  utilization report (`getUtilizationReport` in
  `src/services/reportService.ts`) reconstructs `occupied` windows as the
  complement of the stored `vacant` windows within the requested range.
- **Nishani purge FK safety required a schema fix.** Decision #17 says a
  nishani gets hard-deleted once every game linked to them is fully paid —
  but the original schema had `Game.loserCustomerId`, `Payment.customerId`
  and `CollateralItem.customerId` as required (non-null) foreign keys,
  which would make that hard delete throw a Postgres FK violation on any
  nishani with real (paid) game history — arguably the *common* case this
  feature targets. Fixed by making those three FKs nullable with
  `onDelete: SetNull` (see the comment block above the `Game` model in
  `prisma/schema.prisma`): deleting a nishani now nulls out the dangling
  reference on already-settled games/payments/collateral while preserving
  those rows (and the revenue they represent) intact.
- **Idle-alert exposure**: `GET /reports/idle-alerts` always computes on
  demand directly from the DB (`getIdleAlerts` in
  `src/services/reportService.ts`) — the query is cheap (there are only
  ever a handful of open games at once) so the response is never more than
  one query stale. `src/jobs/idleAlertScan.ts` is the periodic node-cron
  job described in the contract's "Background jobs" section; it
  additionally refreshes an in-memory cache (`getCachedIdleAlerts`) for any
  future push-style consumer (e.g. a websocket broadcast) and logs
  newly-crossed-threshold alerts server-side.
- **Sync push (`POST /sync/push`) scopes to `entityType: "game"`.** The
  `localUuid` unique constraint the contract's idempotency guarantee is
  built on only exists on the `games` table in `prisma/schema.prisma`.
  Payments/expenses/collateral are created directly via their own REST
  endpoints by the desktop app once back online, rather than replayed
  through this generic operation log.
- **Settlement amount must equal the sum of the selected rounds.**
  `POST /payments` requires `amount` to exactly match the sum of the
  selected `gameIds`' final prices — "partial settlement" means settling a
  subset of a customer's unsettled *rounds*, not a partial amount against a
  single round (there's no per-game partial-payment field in the schema).
- **Logout's `declaredCashAmount` fallback** (behavioral requirement #1):
  when `POST /auth/logout` isn't given a `declaredCashAmount`, it falls
  back to the shift's own computed `systemCashTotal` — i.e. assumes zero
  cash variance rather than guessing, so a forgotten/forced logout never
  fabricates a shortage or overage on the Z-report. The desktop app's
  normal flow should still prefer calling `POST /shifts/:id/close` directly
  with a real counted cash amount; this fallback exists purely so logout
  never leaves a shift dangling open (see
  `src/services/shiftService.ts`'s `closeOpenShiftForLogout`).
- **Re-authentication on every request.** `requireAuth`
  (`src/auth/middleware.ts`) re-checks the caller's `isActive`/role against
  the DB on every request rather than trusting the JWT claims verbatim, so
  disabling a staff account takes effect immediately instead of only after
  their token expires. The extra query is a single indexed PK lookup.

## Backup recommendation (decision #14)

The desktop app handles its own local SQLite backup (see
`apps/desktop/src/main/backup.ts`). Server-side, this repo does not run
backups itself — that's an infrastructure/ops concern, not application
code — but the recommended setup for whatever Postgres host is used is:

```bash
# nightly, via cron on the DB host or a small ops box with network access
# to Postgres — keep, say, the last 14 daily dumps:
pg_dump --format=custom --file="/backups/snooker-$(date +%F).dump" "$DATABASE_URL"
find /backups -name 'snooker-*.dump' -mtime +14 -delete
```

If using a managed Postgres provider (Supabase, RDS, etc.), prefer its
built-in automated daily backups/point-in-time-recovery feature over a
hand-rolled `pg_dump` cron where available — enable it and note the
retention window here once chosen. Either way, periodically test a
restore (`pg_restore`) into a scratch database — an untested backup is not
a backup.
