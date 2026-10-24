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
