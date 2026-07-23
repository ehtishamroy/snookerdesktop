# Decisions Log — Clarifying Q&A on the Original Spec

The base spec is `Snooker_Club_Management_System_Spec.pdf` (July 2026, Deekod
Digital). Its §14 ("What the Original Requirements Are Missing") raised 19
open questions. The owner answered all of them; this document is the single
source of truth for how each answer was translated into the system, so any
developer picking this up later understands *why* the code does what it does
without re-litigating settled decisions.

| # | Spec §14 item | Owner's answer | Where it's implemented |
|---|---|---|---|
| 1 | Overtime billing rule | Bill strictly **per minute** past the block, not rounded to the next block and not a flat fee. Finishing early still bills the full block (no downward proration). | `packages/shared/src/pricing.ts` (`computeBilling`) |
| 2 | Price change history | Required. Old sessions must always show the price that applied when played, even after the owner changes prices later. | `pricing_rules` versioning (`effective_from`/`effective_to`), `apps/server/prisma/schema.prisma` |
| 3 | Discount approval workflow | **No approval gate.** Any staff member can apply any discount amount. Still fully attributed (`discount_by_user_id`, `discount_reason`) for audit/reporting, but never blocked or routed for sign-off. | `packages/shared/src/pricing.ts` (`applyDiscount`), `games.discountById` |
| 4 | Collateral item return tracking | Add it. | `collateral_items.returned` / `returned_at` / `returned_by_user_id`, return action in Register/Ledger UI |
| 5 | Cash reconciliation / shift close | Build it. A "Close Shift" action locks the day's entries and produces a Z-report (declared cash vs system total). **Shift close and logout are the same action**: logging out force-closes the open shift (prompting declared cash first); closing the shift always logs the user out afterward. | `shifts` table, `packages/shared/src/shift.ts` (`buildZReport`), desktop logout/shift-close flow |
| 6 | Receipt printing | **Not needed.** No receipt generation/printing anywhere in the system. | N/A — intentionally omitted |
| 7 | Multiple payment methods | Needed. Every payment captures its method (cash / EasyPaisa / JazzCash / card) so end-of-day reconciliation shows exactly how much cash vs EasyPaisa should be on hand. | `payments.method`, `PAYMENT_METHODS` in shared constants, Z-report breakdown by method |
| 8 | Table maintenance status | **Not needed.** No "Out of Service" / maintenance state. A table is simply active or inactive; status tracking is only `occupied`/`vacant`. | `TableStatusValue` enum has only `occupied`/`vacant`; `tables.isActive` is a simple toggle, not a tracked status |
| 9 | Reservation / booking | **Not needed — 100% walk-in.** No booking/reservation module. | N/A — intentionally omitted |
| 10 | Peak/off-peak or weekend pricing | **Not needed.** Admin (owner) can change prices at any time via the versioned pricing table; no time-of-day/day-of-week pricing tiers. | `pricing_rules` (flat, versioned, no peak flag) |
| 11 | Canteen/inventory (drinks, snacks, cues, chalk sales) | **Not a POS module.** Instead, add a simple **expense** entry: amount, method (cash/EasyPaisa), and a note field, to record money paid out of the drawer (e.g. restocking canteen items, repairs). | `expenses` table, `packages/shared/src/shift.ts` (expenses reduce cash-in-hand in the Z-report) |
| 12 | Staff shift/attendance tracking | **Yes, wanted.** Since per-user earnings are already required, track clock-in/clock-out for payroll purposes. This is the same `shifts` record used for cash reconciliation — one open/close action serves both purposes. | `shifts.openedAt` / `closedAt` |
| 13 | Customer privacy/data handling | **No privacy policy needed** (Pakistan-based operation, not subject to the UK-Ltd concern raised in the original spec). No privacy-policy screen/document was built. | N/A — intentionally omitted |
| 14 | Backup & disaster recovery | **Needed.** Desktop app performs a scheduled local backup of its SQLite file to a configurable folder (e.g. a second drive or USB) so a counter PC's disk failure doesn't lose unsynced data. Server-side: standard scheduled Postgres backups (documented in `apps/server/README.md`). | `apps/desktop/src/main/backup.ts` |
| 15 | Multi-branch scalability | **Not needed.** No `branch_id` column anywhere; single-club scope only. | N/A — intentionally omitted |
| 16 | Auto-detection of forgotten "End Game" | **Yes, important.** Idle-timeout alert when a game has run past double its expected block duration. | `packages/shared/src/idle.ts` (`checkIdleAlert`), desktop dashboard polling + alert banner |
| 17 | Merge tool for duplicate customers | **Yes, needed.** Explicit merge screen for collapsing informal-name duplicates into one profile, preserving full history. **Nishani ("temp name") records are intentionally NOT kept permanently** — once every game linked to a nishani record is fully paid and it was never merged into a real customer, the record is purged (hard-deleted, since it was never a real identity and doesn't need an audit trail of its own). Nishani records also never appear in the real-customer autosuggest list. | Admin → Customer Merge screen (owner-dashboard & desktop), `apps/server/src/jobs/purgeNishani.ts` |
| 18 | Refunds | **No refunds.** Overcharges/disputes are handled only via the existing reversal (soft-delete) + re-create flow — there is no separate "refund" concept or UI. | Existing audit/reversal model (`games.reversed`) covers this |
| 19 | Testing/QA and rollout plan | Out of scope for this build pass; recommend running in parallel with the paper register for 1–2 weeks per the original spec before full cutover. | Noted here for the owner, not a code deliverable |

## Architecture scope for this build

Per an explicit follow-up decision (full architecture as specified), this
repository implements all three components from spec §3.1:

1. **`apps/desktop`** — Electron + React counter app, offline-first, local
   SQLite, background sync worker.
2. **`apps/server`** — Node/Express + Prisma + Postgres cloud backend: auth,
   sync push/pull, reports, and enforcement of role-based access.
3. **`apps/owner-dashboard`** — Next.js PWA for the owner, reading only from
   the synced cloud data (never talks to desktop apps directly, per §3.3.6).

Shared business logic (pricing/overtime, discounts, the loan ledger,
Z-report/cash reconciliation, idle detection, table utilization) lives once
in `packages/shared` and is imported by both the server and the desktop app
so the rules can never drift between "online" and "offline" calculations.
