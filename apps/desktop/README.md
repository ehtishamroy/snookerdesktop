# @snooker/desktop — Counter App

Electron + React + TypeScript + Vite counter application used by receptionists
at the club. Fully offline-capable: every write lands in a local SQLite
database instantly, and a background sync engine pushes/pulls against the
cloud backend (`apps/server`) whenever internet is available. See
`/docs/DECISIONS.md` and `/docs/API_CONTRACT.md` for the business rules and
wire contract this app implements.

## Running in development

```bash
pnpm install        # from the repo root — installs all workspaces
pnpm --filter @snooker/desktop dev
```

`pnpm dev` runs a single Vite process: it serves the React renderer with HMR
*and* builds/watches the Electron main process + preload script via
`vite-plugin-electron`, which also launches (and live-reloads) the Electron
window automatically. There is no separate "start electron" step to run by
hand.

> **Native modules**: `better-sqlite3` ships a compiled native addon. In a
> fresh checkout, or after bumping Electron's version, you may need to run
> `pnpm rebuild` (or `pnpm --filter @snooker/desktop exec electron-builder
> install-app-deps`) so the addon is built against Electron's Node ABI rather
> than your system Node's. This is expected to be a separate step handled
> outside of this pass.

On first launch, the app seeds:
- 6 tables (1–5 standard, 6 private room) and the 5 game types with their
  spec §2.1 launch pricing.
- A bootstrap **owner** account: username `owner`, PIN `0000`. **Change this
  PIN immediately** from Admin Settings → Staff Accounts once you've signed
  in — it only exists so a brand-new install is usable before the very first
  successful sync.

## Configuration

Two things are configurable, both from **Admin Settings** inside the app (or
directly by editing the local `app_settings` table for scripted setups):

- **Sync server URL** — where `POST /sync/push` and `GET /sync/pull` are
  called (`http://localhost:4000/api` by default in development).
- **Backup folder** — a local (or USB/second-drive) folder the SQLite file is
  copied into on a schedule (decision #14), plus how many hours between
  backups. Nothing is backed up until a folder is chosen.

The local SQLite file itself lives in Electron's per-user app-data directory
(e.g. `%APPDATA%\snooker-counter\snooker-counter.sqlite3` on Windows). Set the
`SNOOKER_DB_PATH` environment variable to point it somewhere else (used by
the test suite to run against a throwaway file).

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Vite dev server + Electron, with HMR/live-reload |
| `pnpm build` | Typecheck, then build the renderer + main + preload into `dist/` / `dist-electron/` |
| `pnpm typecheck` | `tsc --noEmit` for the main-process project and the renderer project separately (they target different runtime environments) |
| `pnpm test` | Vitest |
| `pnpm package` | Builds, then runs `electron-builder` to produce a Windows `.exe`/`.msi` installer (see `electron-builder.yml`) — also works for the local platform (Linux AppImage / macOS dmg) for quick manual testing |

## Packaging

`electron-builder.yml` targets Windows NSIS (`.exe`, both per-machine and
per-user installs, with an optional custom install directory), matching spec
§3.4. Auto-update via `electron-updater` is intentionally **not** wired up in
this pass — `src/main/index.ts`'s `app.whenReady()` callback has a clearly
marked comment showing exactly where `autoUpdater.checkForUpdatesAndNotify()`
belongs once that's ready to add.

## Project layout

```
src/
  main/            Electron main process (Node): DB, IPC handlers, sync engine
    db/            better-sqlite3 client, schema.sql, one repository per entity
    ipc/           ipcMain.handle() registrations — thin wrappers over repositories
    sync/          syncEngine, pushPayload/pullMerge helpers, idleAlertPoller, backup
    preload.ts     contextBridge — exposes the typed `window.api` surface
  ipc/
    contract.ts    The ONE typed contract shared by main, preload, and renderer
  renderer/        React app (Vite)
    screens/       One file per screen (spec §5)
    components/    Shared UI building blocks (TableTile, AutosuggestInput, …)
    state/         zustand stores
    api/           Thin typed wrapper around `window.api`
```

## Offline-first design notes

- Every write is local-SQLite-first, inside a transaction, before the UI ever
  reports success (see any `src/main/db/repositories/*.ts` — each mutating
  function wraps its own `db.transaction(...)`).
- Every write also appends a `sync_queue` row **in the same transaction**, so
  a write can never "succeed" locally without also being queued for sync.
- The sync engine (`src/main/sync/syncEngine.ts`) polls every 15s, pushes one
  queued operation at a time (so foreign-key resolution between locally-
  created rows stays simple and correct — see `pushPayload.ts`'s header
  comment for why), and pulls remote changes via `GET /sync/pull`
  (`pullMerge.ts`), applying last-write-wins conflict resolution while always
  preserving the losing version in `audit_log`.
- Nothing about local operation ever blocks on the network — the renderer
  only ever *observes* sync status (`Synced`/`Syncing`/`Offline`/`Error` +
  pending count) via the indicator in the top bar.
