# Snooker Club Management System

An offline-first management system for a 6-table snooker club (5 standard
tables + Table 6, a private room with its own price list). Built from
`Snooker_Club_Management_System_Spec.pdf` plus an explicit clarifying Q&A
round with the owner — **see [`docs/DECISIONS.md`](docs/DECISIONS.md) first**,
it is the single source of truth for every business-rule choice made in this
codebase and where each one is implemented.

## What's in this repo

A pnpm monorepo with three applications sharing one business-logic package:

```
packages/shared/          Pricing/overtime engine, discount calc, the "losing
                           chain" customer ledger, Z-report/cash reconciliation,
                           idle-timeout detection, table utilization — pure,
                           fully unit-tested TypeScript used by BOTH the
                           server and the desktop app so the rules can never
                           drift between "online" and "offline" calculations.

apps/server/               Cloud backend: Node/Express + Prisma + PostgreSQL.
                           Auth, role-based access, the REST API in
                           docs/API_CONTRACT.md, offline-sync push/pull,
                           reports/CSV export, background jobs (nishani purge,
                           idle-alert scan).

apps/desktop/              The counter app: Electron + React + Vite, local
                           SQLite (better-sqlite3), fully usable with zero
                           internet. Every write lands locally first and is
                           queued for a background sync worker.

apps/owner-dashboard/      Next.js PWA for the owner: live table status,
                           analytics, loan ledger, staff performance/
                           attendance, expenses, reversal/edit history, and
                           admin screens (pricing versioning, staff accounts,
                           customer merge). Reads only from the cloud backend.

docs/DECISIONS.md          Maps every one of the owner's 19 clarifying answers
                           to where it's implemented. Read this before
                           changing any business rule.
docs/API_CONTRACT.md       The REST API apps/server implements and the
                           desktop/owner-dashboard apps consume.
```

## Quick start

```bash
pnpm install                       # installs all 4 workspaces
pnpm --filter @snooker/shared test # 21 tests — the business-logic core

# Backend
cp apps/server/.env.example apps/server/.env   # set DATABASE_URL, JWT_SECRET
pnpm --filter @snooker/server prisma:generate
pnpm --filter @snooker/server prisma:migrate
pnpm --filter @snooker/server prisma:seed      # seeds tables/pricing/an owner login
pnpm --filter @snooker/server dev              # http://localhost:4000

# Owner dashboard (needs the backend running)
cp apps/owner-dashboard/.env.example apps/owner-dashboard/.env.local
pnpm --filter @snooker/owner-dashboard dev      # http://localhost:3000

# Desktop counter app (works fully offline once built; needs the backend only to sync)
pnpm --filter @snooker/desktop dev
```

See each app's own README for full details:
[`apps/server/README.md`](apps/server/README.md),
[`apps/desktop/README.md`](apps/desktop/README.md),
[`apps/owner-dashboard/README.md`](apps/owner-dashboard/README.md).

## Verified state of this build

- `pnpm -r typecheck` — clean across all 4 workspaces.
- `pnpm -r test` — **50/50 tests passing** (21 shared pricing/ledger/shift/
  idle/utilization tests, 26 server integration tests against an in-memory
  Prisma-compatible fake DB, 3 desktop tests against a real local SQLite
  file exercising the actual counter flow).
- `pnpm --filter @snooker/server build` — tsc + esbuild bundle, clean.
- `pnpm --filter @snooker/desktop build` — Vite builds the renderer, the
  Electron main process, and the preload script, all clean.
- `pnpm --filter @snooker/owner-dashboard build` — `next build` production
  build, clean.

**Known sandbox limitation**: this development environment has no display
and its network egress policy blocks the Electron binary download (a large
GitHub release asset), so the actual Electron window could not be launched
and clicked through here. The renderer, main process, and preload all build
and typecheck correctly, and the core counter logic (billing, sync queue,
discounts) is covered by real integration tests against actual SQLite — but
someone with a normal desktop environment should still click through the
app before it goes live at the club, per the spec's own recommendation
(§14.19) to run in parallel with the paper register for the first 1–2 weeks.

## Business rules — the short version

Full detail and rationale in [`docs/DECISIONS.md`](docs/DECISIONS.md). In
brief: overtime bills strictly per-minute past a game's block; prices are
versioned so historical reports never change retroactively; discounts are
unrestricted (any staff, any amount, still fully attributed for audit);
collateral items track their return; payments capture cash/EasyPaisa/
JazzCash/card for reconciliation; a "close shift" action produces a
cash-reconciliation Z-report and doubles as staff clock-out (closing the
shift always logs the user out, and logging out always closes the shift);
an idle-timeout alert flags a forgotten "End Game"; nishani (temporary
name) customers are intentionally not kept permanently — they're purged
once fully settled unless merged into a real customer; there's no receipt
printing, reservations, peak/weekend pricing, table-maintenance status,
canteen POS (replaced by a simple expense ledger), multi-branch support, or
refunds (only the existing reversal/audit flow).
