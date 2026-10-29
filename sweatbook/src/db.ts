import { DatabaseSync } from "node:sqlite";

// All database access goes through this module and src/data/: node:sqlite is still young, and keeping it in one place
// keeps a later switch (another driver, or Postgres when the app moves to a real server) small.
//
// SQL rules (see AGENTS.md): portable SQL only. UUIDs as TEXT, timestamps as ISO-8601 strings in UTC written by the app,
// booleans as INTEGER 0/1, no COLLATE NOCASE, never query inside JSON. The one deliberate exception is STRICT.

// One entry per schema version, applied in order and recorded in schema_migrations. Only ever append, never edit.
export const MIGRATIONS: readonly string[] = [
  // v1: Phase 1, logging strength training (see "Datenmodell" in AGENTS.md).
  `
  CREATE TABLE app_user (
    id TEXT PRIMARY KEY,
    ha_user_id TEXT NOT NULL UNIQUE,
    display_name TEXT,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE exercise (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    metrics TEXT NOT NULL CHECK (metrics IN ('weight_reps', 'duration', 'weight_duration')),
    note TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX exercise_name ON exercise(user_id, lower(name));

  CREATE TABLE exercise_alias (
    exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    alias TEXT NOT NULL CHECK (length(trim(alias)) > 0),
    PRIMARY KEY (exercise_id, alias)
  ) STRICT;
  CREATE UNIQUE INDEX exercise_alias_name ON exercise_alias(user_id, lower(alias));

  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    title TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX session_user_started ON session(user_id, started_at);

  CREATE TABLE block (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('straight', 'superset')),
    params TEXT
  ) STRICT;
  CREATE INDEX block_session ON block(session_id, position);

  CREATE TABLE block_exercise (
    id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL REFERENCES block(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX block_exercise_block ON block_exercise(block_id, position);
  CREATE INDEX block_exercise_exercise ON block_exercise(exercise_id);

  CREATE TABLE set_log (
    id TEXT PRIMARY KEY,
    block_exercise_id TEXT NOT NULL REFERENCES block_exercise(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    weight_kg REAL CHECK (weight_kg >= 0),
    reps INTEGER CHECK (reps >= 0),
    duration_s INTEGER CHECK (duration_s >= 0),
    is_max INTEGER NOT NULL DEFAULT 0 CHECK (is_max IN (0, 1)),
    note TEXT,
    extra TEXT,
    logged_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX set_log_block_exercise ON set_log(block_exercise_id, position);
  `,
  // v2: a note per exercise in a session, e.g. the plan ("5 × max, 2 min Pause").
  `ALTER TABLE block_exercise ADD COLUMN note TEXT;`,
  // v3: which fields a set has is chosen per exercise (kg, reps, distance, time) instead of three fixed kinds, and sets
  // get a distance. The old kinds map onto the new flags.
  `
  ALTER TABLE exercise ADD COLUMN has_weight INTEGER NOT NULL DEFAULT 0 CHECK (has_weight IN (0, 1));
  ALTER TABLE exercise ADD COLUMN has_reps INTEGER NOT NULL DEFAULT 0 CHECK (has_reps IN (0, 1));
  ALTER TABLE exercise ADD COLUMN has_distance INTEGER NOT NULL DEFAULT 0 CHECK (has_distance IN (0, 1));
  ALTER TABLE exercise ADD COLUMN has_duration INTEGER NOT NULL DEFAULT 0 CHECK (has_duration IN (0, 1));
  UPDATE exercise SET
    has_weight = CASE WHEN metrics IN ('weight_reps', 'weight_duration') THEN 1 ELSE 0 END,
    has_reps = CASE WHEN metrics = 'weight_reps' THEN 1 ELSE 0 END,
    has_duration = CASE WHEN metrics IN ('duration', 'weight_duration') THEN 1 ELSE 0 END;
  ALTER TABLE exercise DROP COLUMN metrics;
  ALTER TABLE set_log ADD COLUMN distance_m INTEGER CHECK (distance_m >= 0);
  `,
  // v4: Phase 2, programs (multi-week plans with targets), test values and the links from a session back to its plan.
  `
  CREATE TABLE program (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX program_user ON program(user_id);

  CREATE TABLE program_week (
    id TEXT PRIMARY KEY,
    program_id TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK (number >= 1),
    phase TEXT,
    deload INTEGER NOT NULL DEFAULT 0 CHECK (deload IN (0, 1)),
    UNIQUE (program_id, number)
  ) STRICT;

  CREATE TABLE planned_session (
    id TEXT PRIMARY KEY,
    week_id TEXT NOT NULL REFERENCES program_week(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    label TEXT NOT NULL,
    skipped_at TEXT,
    skip_note TEXT
  ) STRICT;
  CREATE INDEX planned_session_week ON planned_session(week_id, position);

  CREATE TABLE planned_item (
    id TEXT PRIMARY KEY,
    planned_session_id TEXT NOT NULL REFERENCES planned_session(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    exercise_id TEXT REFERENCES exercise(id) ON DELETE RESTRICT,
    label TEXT,
    sets_min INTEGER CHECK (sets_min >= 1),
    sets_max INTEGER CHECK (sets_max >= 1),
    reps_min INTEGER CHECK (reps_min >= 0),
    reps_max INTEGER CHECK (reps_max >= 0),
    distance_min_m INTEGER CHECK (distance_min_m >= 0),
    distance_max_m INTEGER CHECK (distance_max_m >= 0),
    duration_min_s INTEGER CHECK (duration_min_s >= 0),
    duration_max_s INTEGER CHECK (duration_max_s >= 0),
    to_max INTEGER NOT NULL DEFAULT 0 CHECK (to_max IN (0, 1)),
    load_kg REAL CHECK (load_kg >= 0),
    load_pct REAL CHECK (load_pct > 0),
    load_ref_exercise_id TEXT REFERENCES exercise(id) ON DELETE RESTRICT,
    test_kind TEXT CHECK (test_kind IN ('one_rm', 'best')),
    rest TEXT,
    note TEXT,
    params TEXT,
    CHECK (load_kg IS NULL OR load_pct IS NULL),
    CHECK ((load_pct IS NULL) = (load_ref_exercise_id IS NULL))
  ) STRICT;
  CREATE INDEX planned_item_session ON planned_item(planned_session_id, position);

  CREATE TABLE exercise_test (
    id TEXT PRIMARY KEY,
    exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
    tested_on TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('one_rm', 'best')),
    weight_kg REAL CHECK (weight_kg >= 0),
    reps INTEGER CHECK (reps >= 0),
    distance_m INTEGER CHECK (distance_m >= 0),
    duration_s INTEGER CHECK (duration_s >= 0),
    set_id TEXT REFERENCES set_log(id) ON DELETE CASCADE, -- a test taken from a set goes with it
    note TEXT
  ) STRICT;
  CREATE INDEX exercise_test_exercise ON exercise_test(exercise_id, tested_on);

  ALTER TABLE session ADD COLUMN planned_session_id TEXT REFERENCES planned_session(id) ON DELETE SET NULL;
  ALTER TABLE block_exercise ADD COLUMN planned_item_id TEXT REFERENCES planned_item(id) ON DELETE SET NULL;
  CREATE INDEX session_planned ON session(planned_session_id);
  `,
];

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  // Runtime settings, not schema: without foreign_keys SQLite does not check references at all.
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

// Version = position in MIGRATIONS, starting at 1. The table works the same way in Postgres (and is what dbmate uses).
export function migrate(db: Db, migrations: readonly string[] = MIGRATIONS, now: () => string = isoNow): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT");
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  for (let version = (row.v ?? 0) + 1; version <= migrations.length; version++) {
    transaction(db, () => {
      db.exec(migrations[version - 1]!);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, now());
    });
  }
}

export function schemaVersion(db: Db): number {
  return (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null }).v ?? 0;
}

// SQLite has no nested BEGIN: functions that run inside a transaction must not open one themselves.
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Timestamps are written by the app, never by the database (portable SQL): ISO-8601 in UTC.
export function isoNow(): string {
  return new Date().toISOString();
}
