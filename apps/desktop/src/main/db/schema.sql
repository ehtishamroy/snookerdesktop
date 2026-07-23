-- Local SQLite schema for the offline-first counter app. Mirrors the shape of
-- apps/server/prisma/schema.prisma (see that file's header comment for the
-- business-rule rationale — pricing_rules versioning, unrestricted discounts,
-- collateral return tracking, occupied/vacant-only table status, etc.) but is
-- hand-maintained here since better-sqlite3 has no Prisma migration engine.
--
-- ID strategy (offline-first): every row this app can itself CREATE carries a
-- `local_uuid` (generated with crypto.randomUUID() at write time) which is
-- the idempotency key used by the sync engine's POST /sync/push, plus a
-- nullable `server_id` populated once the cloud backend confirms the write
-- and assigns its own integer id. Local foreign keys always point at the
-- local `id` column (never `server_id`), so the local DB is fully
-- self-consistent even entirely offline. `tables` and `game_types` are
-- reference/catalogue data owned by the server (seeded once, occasionally
-- edited by the owner) — for those two tables `id` IS the server id, there is
-- no separate local numbering scheme to reconcile.
--
-- `table_status_log` is derived/local-only: the API contract states the
-- server manages table_status_log automatically from game start/end events
-- and does not accept direct client writes to it, so the desktop maintains
-- its own copy purely to drive the live dashboard tiles and the local
-- utilization report while offline; it is not pushed through sync_queue.
--
-- `sync_queue` and `app_settings` are local-only tables with no server
-- equivalent at all.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Local-only tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uuid   TEXT NOT NULL,
  entity_type  TEXT NOT NULL, -- 'users' | 'tables' | 'pricing_rules' | 'customers' | 'games' | 'payments' | 'collateral_items' | 'shifts' | 'expenses' | 'audit_log'
  operation    TEXT NOT NULL CHECK (operation IN ('insert', 'update')),
  payload      TEXT NOT NULL, -- JSON snapshot of the entity as of this write
  created_at   TEXT NOT NULL,
  synced       INTEGER NOT NULL DEFAULT 0,
  synced_at    TEXT,
  retry_count  INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue (synced, created_at);

-- ---------------------------------------------------------------------------
-- Reference / catalogue data (server-owned; id = server id)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tables (
  id           INTEGER PRIMARY KEY,
  table_number INTEGER NOT NULL UNIQUE,
  table_type   TEXT NOT NULL CHECK (table_type IN ('standard', 'private_room')),
  label        TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS game_types (
  id                       INTEGER PRIMARY KEY,
  code                     TEXT NOT NULL UNIQUE, -- '6_ball' | '6_ball_double' | 'full_frame' | 'full_frame_double' | 'century'
  name                     TEXT NOT NULL,
  default_duration_minutes INTEGER NOT NULL,
  is_active                INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- Syncable transactional tables (local_uuid + server_id pattern)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pricing_rules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uuid       TEXT NOT NULL UNIQUE,
  server_id        INTEGER,
  table_type       TEXT NOT NULL CHECK (table_type IN ('standard', 'private_room')),
  game_type_id     INTEGER NOT NULL REFERENCES game_types (id),
  price            INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  effective_from   TEXT NOT NULL,
  effective_to     TEXT,
  created_by_id    INTEGER NOT NULL REFERENCES users (id),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_lookup ON pricing_rules (table_type, game_type_id, effective_from);

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uuid   TEXT NOT NULL UNIQUE,
  server_id    INTEGER,
  full_name    TEXT NOT NULL,
  username     TEXT NOT NULL UNIQUE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'receptionist')),
  pin_hash     TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Customers, including temporary "nishani" placeholders (decision #17: these
-- must never surface in the normal autosuggest — enforced in customersRepo's
-- search query, not just at the server, per the desktop's own responsibility).
CREATE TABLE IF NOT EXISTS customers (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uuid              TEXT NOT NULL UNIQUE,
  server_id               INTEGER,
  display_name            TEXT NOT NULL,
  is_temporary            INTEGER NOT NULL DEFAULT 0,
  nishani_description     TEXT,
  merged_into_customer_id INTEGER REFERENCES customers (id),
  phone                   TEXT,
  notes                   TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_display_name ON customers (display_name);
CREATE INDEX IF NOT EXISTS idx_customers_is_temporary ON customers (is_temporary);

CREATE TABLE IF NOT EXISTS shifts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uuid           TEXT NOT NULL UNIQUE,
  server_id            INTEGER,
  user_id              INTEGER NOT NULL REFERENCES users (id),
  opened_at            TEXT NOT NULL,
  closed_at            TEXT,
  declared_cash_amount INTEGER,
  system_cash_total    INTEGER,
  cash_variance        INTEGER,
  is_locked            INTEGER NOT NULL DEFAULT 0,
  closed_by_id         INTEGER REFERENCES users (id),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_shifts_user_open ON shifts (user_id, closed_at);

CREATE TABLE IF NOT EXISTS games (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uuid               TEXT NOT NULL UNIQUE,
  server_id                INTEGER,
  table_id                 INTEGER NOT NULL REFERENCES tables (id),
  game_type_id             INTEGER NOT NULL REFERENCES game_types (id),
  start_time               TEXT NOT NULL,
  end_time                 TEXT,
  duration_actual_minutes  REAL,
  duration_billed_minutes  INTEGER,
  price_original           INTEGER NOT NULL,
  discount_amount          INTEGER NOT NULL DEFAULT 0,
  discount_reason          TEXT,
  discount_by_id           INTEGER REFERENCES users (id),
  price_final              INTEGER NOT NULL,
  loser_customer_id        INTEGER NOT NULL REFERENCES customers (id),
  winner_customer_id       INTEGER REFERENCES customers (id),
  payment_status           TEXT NOT NULL CHECK (payment_status IN ('paid', 'pending', 'loan', 'collateral', 'tricked')),
  created_by_user_id       INTEGER NOT NULL REFERENCES users (id),
  shift_id                 INTEGER NOT NULL REFERENCES shifts (id),
  reversed                 INTEGER NOT NULL DEFAULT 0,
  reversed_by_id           INTEGER REFERENCES users (id),
  reversed_reason          TEXT,
  reversed_at              TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_games_loser_status ON games (loser_customer_id, payment_status, reversed);
CREATE INDEX IF NOT EXISTS idx_games_table_start ON games (table_id, start_time);
CREATE INDEX IF NOT EXISTS idx_games_open ON games (table_id, end_time, reversed);

CREATE TABLE IF NOT EXISTS payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uuid          TEXT NOT NULL UNIQUE,
  server_id           INTEGER,
  customer_id         INTEGER NOT NULL REFERENCES customers (id),
  amount              INTEGER NOT NULL,
  method              TEXT NOT NULL CHECK (method IN ('cash', 'easypaisa', 'jazzcash', 'card')),
  note                TEXT,
  paid_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  collected_by_user_id INTEGER NOT NULL REFERENCES users (id),
  shift_id            INTEGER NOT NULL REFERENCES shifts (id)
);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments (customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_shift ON payments (shift_id);

CREATE TABLE IF NOT EXISTS payment_game_links (
  payment_id INTEGER NOT NULL REFERENCES payments (id),
  game_id    INTEGER NOT NULL REFERENCES games (id),
  PRIMARY KEY (payment_id, game_id)
);

CREATE TABLE IF NOT EXISTS collateral_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uuid          TEXT NOT NULL UNIQUE,
  server_id           INTEGER,
  game_id             INTEGER NOT NULL REFERENCES games (id),
  customer_id         INTEGER NOT NULL REFERENCES customers (id),
  item_description    TEXT NOT NULL,
  held_by_user_id     INTEGER NOT NULL REFERENCES users (id),
  held_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  returned             INTEGER NOT NULL DEFAULT 0,
  returned_at          TEXT,
  returned_by_user_id  INTEGER REFERENCES users (id),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_collateral_customer ON collateral_items (customer_id, returned);

CREATE TABLE IF NOT EXISTS expenses (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uuid          TEXT NOT NULL UNIQUE,
  server_id           INTEGER,
  category            TEXT NOT NULL,
  amount              INTEGER NOT NULL,
  method              TEXT NOT NULL CHECK (method IN ('cash', 'easypaisa', 'jazzcash', 'card')),
  note                TEXT,
  spent_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  recorded_by_user_id INTEGER NOT NULL REFERENCES users (id),
  shift_id            INTEGER NOT NULL REFERENCES shifts (id)
);
CREATE INDEX IF NOT EXISTS idx_expenses_shift ON expenses (shift_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uuid      TEXT NOT NULL UNIQUE,
  server_id       INTEGER,
  entity_type     TEXT NOT NULL,
  entity_id       INTEGER NOT NULL,
  action          TEXT NOT NULL, -- 'create' | 'update' | 'reverse' | 'merge' | 'return_collateral' | 'shift_open' | 'shift_close' | 'sync_conflict_superseded'
  before_value    TEXT, -- JSON
  after_value     TEXT, -- JSON
  performed_by_id INTEGER NOT NULL REFERENCES users (id),
  performed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_at ON audit_log (performed_at);

-- ---------------------------------------------------------------------------
-- Local-only derived table (see header note — never pushed to sync_queue)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS table_status_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id    INTEGER NOT NULL REFERENCES tables (id),
  status      TEXT NOT NULL CHECK (status IN ('occupied', 'vacant')),
  status_from TEXT NOT NULL,
  status_to   TEXT
);
CREATE INDEX IF NOT EXISTS idx_table_status_log_table ON table_status_log (table_id, status_from);
