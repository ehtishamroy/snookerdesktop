# @snooker/owner-dashboard

Owner-facing analytics & admin **PWA** for the Snooker Club Management
System. Built with Next.js (App Router) + TypeScript + Tailwind CSS.

This app is a **pure client of the cloud backend** (`apps/server`, see
`/docs/API_CONTRACT.md`). Per spec §3.3.6 it never talks to a desktop app
directly and never writes to any local SQLite file — every read and the
handful of admin writes (pricing, staff accounts, customer merge,
mark-collateral-returned, table active/inactive) go through the same REST
API the desktop app syncs against.

## Setup

```bash
# from the repo root (pnpm workspaces)
pnpm install                      # run once, at the repo root — not from here
cp apps/owner-dashboard/.env.example apps/owner-dashboard/.env.local
pnpm --filter @snooker/owner-dashboard dev
```

The dashboard runs on **http://localhost:3100** by default (kept off 3000 so
it doesn't collide with `apps/server` or `apps/desktop`'s dev servers if
those run concurrently).

### Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of `apps/server`'s REST API. Defaults to `http://localhost:4000/api`. |

## Scripts

- `pnpm dev` — start the Next.js dev server
- `pnpm build` — production build
- `pnpm start` — run the production build
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` — `next lint`

## PWA approach

No external PWA plugin (`next-pwa`, etc.) is used, to keep the dependency
footprint small and predictable in this build:

- `public/manifest.json` — hand-written web app manifest (name, icons,
  `display: standalone`, theme colors).
- `public/sw.js` — a small hand-written service worker. It precaches the app
  shell (`/`, manifest, icons) for instant loads and stale-while-revalidate
  updates, but **deliberately never intercepts `/api` requests** — this
  dashboard's whole job is showing live synced data, so a stale
  service-worker cache must never silently serve yesterday's revenue.
  Registered client-side in `src/components/AppShell.tsx`.
- `src/app/layout.tsx` links the manifest and sets Apple/PWA meta tags so the
  dashboard is installable on both desktop Chrome/Edge and iOS/Android home
  screens.
- **Icons**: `public/icons/icon.svg` and `icon-maskable.svg` are simple
  placeholder vector icons (a felt-green circle on a rounded square). They
  are enough for Chrome/Android installability. **Replace these with real
  branded PNG/SVG icons before shipping** — in particular, add a proper
  `apple-touch-icon.png` (180×180) for a polished iOS home-screen icon,
  since iOS Safari's PWA support for SVG touch icons is inconsistent.

## Auth: JWT storage tradeoff

`src/lib/tokenStore.ts` stores the JWT + user profile in `localStorage`
(see the tradeoff note in that file). Chosen for this build because:

- It keeps the app 100% static/client-rendered (no server-side session
  needed, no same-site cookie/BFF plumbing to stand up alongside
  `apps/server`).
- The user base is small and trusted (owner + a couple of managers).

**For a hardened production deploy**, prefer having `apps/server` set an
httpOnly, `Secure`, `SameSite=Strict` cookie on login, serving this
dashboard from the same site (or behind a reverse proxy/BFF that shares the
cookie), and adding CSRF protection (the cookie would no longer need to be
attached manually, but browsers also then send it on cross-site requests,
so a double-submit token or `SameSite=Strict` + custom header check is
needed). This localStorage approach is explicitly the "simple, good enough
for v1" choice, not the final word on the topic.

## Data fetching

`swr` is used for all reads, wrapped by typed hooks in `src/hooks/*` calling
the typed client in `src/lib/apiClient.ts`. Real-time push isn't required
per the task brief — the live-status tiles poll every 10s
(`src/hooks/useTables.ts`), other reports revalidate on a longer interval or
on demand, and SWR revalidates on network reconnect (useful for a PWA used
over a flaky mobile connection while walking around the club).

## Role-based access (spec §6 Roles & Permissions Matrix)

`src/lib/roles.ts` encodes which nav items/pages each role may reach; every
restricted page is also wrapped in `src/components/PageGuard.tsx` so
navigating **directly to a URL** (bypassing the nav) degrades gracefully
instead of crashing or leaking data. `src/components/RoleGate.tsx` does the
same for individual UI elements (e.g. the "mark collateral returned" button,
the per-table active/inactive toggle, the whole admin nav section).

- **Owner**: sees and can do everything.
- **Manager**: sees all staff activity, the full ledger, staff performance,
  expenses, collateral, and (per the interpretation below) the **full**
  audit log; can reverse/edit others' entries (enforced server-side per the
  API contract); **cannot** edit global pricing or create/deactivate staff
  accounts — those admin pages are owner-only (`NAV_PERMISSIONS.adminPricing`
  / `adminStaff` in `src/lib/roles.ts`).
- **Receptionist**: per spec §6 ("Access via mobile app: Receptionist ❌")
  this dashboard isn't meant for receptionists at all. Rather than crash or
  block login outright, a receptionist token is handled gracefully: the
  login page accepts it, and the home page (`src/app/page.tsx`) detects the
  role and renders a cut-down "your shifts today" view with **only their own
  shift/attendance data** — no nav links to any other page render for that
  role (see `NAV_PERMISSIONS` and the `MOBILE_NAV`/`visiblePrimary` filtering
  in `src/components/AppShell.tsx`), and every restricted page would show
  the same "no access" `PageGuard` panel if reached directly by URL.

### Interpretation note: manager + "full audit log (partial)"

Spec §6 lists the "View full audit log" permission as **Manager: ✅
(partial)**, **Owner: ✅ (full)**, without ever defining what "partial"
excludes, and neither `docs/DECISIONS.md` nor `docs/API_CONTRACT.md`
resolves it either (the contract's opening note says "manager can [reverse
others' entries]" and generally treats manager as at-parity with owner
except where explicitly owner-only).

This build interprets it as: **a manager sees every `audit_log` entry** —
same who/when/why detail as an owner, on every entity type — because hiding
some *unspecified* subset of entries from the one role explicitly trusted to
review and approve reversals would undermine the audit trail's entire
fraud-prevention purpose, and there's no way to guess *which* entries would
be excluded without inventing a rule the spec never states. What **does**
stay owner-only, consistent with the rest of the matrix, is *acting* on
owner-level administrative surfaces: editing global pricing and
creating/deactivating staff accounts. See `src/lib/roles.ts` for the code
comment version of this reasoning.

## Design decisions not fully specified by the task/spec

1. **Response shapes for report endpoints.** `docs/API_CONTRACT.md`
   precisely specifies inputs and intent for `/reports/*`,
   `/customers/loan-ledger`, `/reports/tricked`, etc., but not their exact
   JSON field names. `src/lib/apiTypes.ts` defines this dashboard's expected
   wire shapes (e.g. `RevenueReport`, `StaffPerformanceEntry`,
   `TableUtilizationWire`, `LoanLedgerEntry`, `TrickedEntry`,
   `TableWithStatus`). If `apps/server`'s actual response fields differ,
   only `apiTypes.ts` + `apiClient.ts` need updating — no page logic should
   need to change.
2. **`GET /collateral-items?returned=false` (list held collateral).** The
   contract only documents `POST /collateral-items` (create) and
   `POST /collateral-items/:id/return`. The Collateral page needs a list of
   currently-held items, so `apiClient.getHeldCollateral()` assumes a GET
   list endpoint following the same `?returned=false` filter convention used
   elsewhere in the contract (e.g. `GET /games?...&reversed=false`). Flagged
   here explicitly for the server team to confirm/implement.
3. **"Top customers by frequency."** Spec §2.10 asks for "top customers by
   frequency / by amount owed." The contract only exposes
   `GET /customers/loan-ledger` (customers with **outstanding** balances).
   There's no endpoint for lifetime visit frequency across *all* games
   (paid included). The Analytics page approximates frequency using each
   ledger entry's `unsettledCount` (rounds currently owed) and labels it
   "Top customers by rounds owed (frequency)" with an inline note explaining
   the limitation — a true lifetime-frequency report would need a new
   `/reports/top-customers?by=frequency` endpoint server-side.
4. **Pricing versioning UX.** Decision #2 requires that changing a price
   never rewrites history. The Admin → Pricing page (`src/app/admin/pricing`)
   never lets you edit an existing `pricing_rules` row in place — "Change
   price" always calls `POST /pricing-rules` (which the contract says closes
   the old row and inserts a new one) and the UI copy explicitly says
   "this starts a new version from now" before every save, plus a full
   version-history modal per (table type, game type).
5. **Nishani/merge screen framing.** Decision #17: nishani records are
   temporary and auto-purged once settled if never merged. The merge page
   (`src/app/admin/merge`) leads with an "Identify a nishani" tab (primary
   flow — pick from currently-owing temporary entries sourced from the loan
   ledger, then search for and confirm the real customer) and a secondary
   "Merge two customer records" tab for informal-duplicate real customers
   (e.g. "Ali" vs "Ali Bhai"). Both flows show a small before-merge preview
   (unsettled rounds + total owed) using `GET /customers/:id/ledger`.
6. **Table active/inactive toggle.** Not called out as its own admin page in
   the task's file list, but decision #8/requirement #4 ("the only
   per-table admin action is active/inactive") still needs a UI. It's
   implemented directly on the live-status table tiles
   (`src/components/TableTile.tsx`, owner-only via `RoleGate`), since that's
   already where every table is shown; a table can't be deactivated while a
   game is in progress on it (client-side guard, mirroring common sense —
   the server is the real source of truth here).
7. **Date-range pickers.** Not specified precisely; built a shared
   `RangePicker` (`src/components/RangePicker.tsx`) with Today / This week /
   This month / Last 7 days / Last 30 days / Custom, reused across
   Analytics, Ledger (tricked log), Staff, Expenses and History.

## Behavioral requirements checklist

1. **Read-mostly; writes only via the cloud API, never to a local desktop
   SQLite.** Every mutation in this app — `POST /pricing-rules`
   (`src/app/admin/pricing/page.tsx`), staff create/update
   (`src/app/admin/staff/page.tsx`), customer merge
   (`src/hooks/useCustomers.ts` → `apiClient.mergeCustomer`), mark-collateral
   -returned (`src/app/collateral/page.tsx` → `apiClient.returnCollateral`),
   and the table active/inactive toggle
   (`src/components/TableTile.tsx` → `apiClient.updateTable`) — goes through
   `src/lib/apiClient.ts`, which only ever calls `NEXT_PUBLIC_API_URL`
   (`apps/server`). No SQLite/desktop import exists anywhere in this app.
2. **Roles matrix (spec §6).** `src/lib/roles.ts` (`NAV_PERMISSIONS`,
   `canAccess`, `CAN_EDIT_PRICING`, `CAN_MANAGE_STAFF`, `CAN_MERGE_CUSTOMERS`,
   `CAN_RETURN_COLLATERAL`, `CAN_MANAGE_TABLES`), enforced in the nav
   (`src/components/AppShell.tsx`), per-page (`src/components/PageGuard.tsx`
   used at the top of every restricted page:
   `analytics/page.tsx:21-27`, `ledger/page.tsx:16-20`,
   `staff/page.tsx:19-24`, `expenses/page.tsx:20-24`,
   `history/page.tsx:16-19`, `collateral/page.tsx:14-19`,
   `admin/pricing/page.tsx:14-19` (owner-only),
   `admin/staff/page.tsx:12-17` (owner-only),
   `admin/merge/page.tsx:14-19`), and per-element
   (`src/components/RoleGate.tsx`, used for the collateral "mark returned"
   button and the table active/inactive toggle). Manager/full-audit-log
   interpretation documented above and in `src/lib/roles.ts`. Receptionist
   degrade-gracefully behavior: `src/app/page.tsx`
   (`isReceptionistDegraded` branch, `ReceptionistOwnShiftView`) plus the
   amber notice banner in `src/components/AppShell.tsx`.
3. **No discount-approval-threshold UI anywhere** (decision #3). Grepping
   this app for "discount" only turns up read-only display of
   `discountsGiven`/`totalDiscountsGiven` totals on the Staff/Analytics pages
   (`src/app/analytics/page.tsx`, `src/app/staff/page.tsx`) — there is no
   threshold setting, no approval queue, and no gating UI anywhere.
4. **No table maintenance-mode toggle** (decision #8). The only per-table
   admin control is the active/inactive toggle on
   `src/components/TableTile.tsx` (see design decision #6 above); there is
   no third "Out of Service"/maintenance status anywhere, matching
   `TableStatusValue` having only `occupied`/`vacant`.
5. **Price editing communicates versioning** (decision #2).
   `src/app/admin/pricing/page.tsx` — the blue banner at the top of the page
   and the copy inside `EditPriceModal` both explicitly state that saving
   starts a new version effective immediately and never rewrites already-
   played games' prices; the page also exposes a per-(table type, game
   type) version-history modal (`HistoryModal`) showing every past
   `effectiveFrom`/`effectiveTo` row.
6. **Payment-method breakdown visible wherever revenue is shown**
   (decision #7). `src/components/PaymentBreakdownBars.tsx`
   (`PaymentMethodBreakdown`) is rendered on: the live dashboard summary
   (`src/app/page.tsx`), the Analytics overall-revenue card and every
   per-staff card (`src/app/analytics/page.tsx`), the Staff performance tab
   (`src/app/staff/page.tsx`), and the Expenses page's method totals
   (`src/app/expenses/page.tsx`). The per-table revenue table and the
   revenue chart (`src/components/RevenueChart.tsx`) also break every bar
   down by method (stacked, never a single lump total) rather than showing
   one aggregate figure.
7. **Nishani/merge UI frames temporary records as temporary** (decision
   #17). `src/app/admin/merge/page.tsx` — see design decision #5 above; the
   page's intro copy and the "Identify a nishani" tab (primary) make this
   explicit, versus a secondary "Merge two customer records" tab for real
   duplicates.
8. **No receipt printing, reservation/booking, peak/weekend pricing, or
   refund UI.** None of these exist anywhere in `src/app/**`. Pricing has no
   time-of-day/day-of-week fields (`admin/pricing/page.tsx` only ever sends
   `{ tableType, gameTypeId, price, durationMinutes }`); ledger settlement
   is view-only here (settlement itself happens at the counter); reversal
   is handled entirely by the read-only History page, with no "refund"
   concept anywhere.
9. **Responsive / PWA.** `src/components/AppShell.tsx` renders a fixed
   left sidebar nav on `lg:` breakpoints and a hamburger-collapsible top bar
   + fixed bottom tab bar below that; all pages use responsive Tailwind grid
   classes (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` etc.) and every wide
   element (tables, charts) sits inside an `overflow-x-auto` container
   (`src/components/DataTable.tsx`, chart cards). PWA installability via
   `public/manifest.json` + `public/sw.js`, see "PWA approach" above.

## Known limitations / follow-ups for the server team

- Confirm/implement `GET /collateral-items?returned=false` (see design
  decision #2 above) — required for the Collateral page.
- Confirm the exact JSON field names for every `/reports/*` and
  `/customers/loan-ledger` response against `src/lib/apiTypes.ts`; adjust
  that file (and, if needed, `src/lib/apiClient.ts`) to match once
  `apps/server`'s real implementation lands.
- A dedicated lifetime "top customers by visit frequency" report (covering
  paid + unpaid games, not just current ledger balances) would let the
  Analytics page drop its current unsettled-rounds proxy.
