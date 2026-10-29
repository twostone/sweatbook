import { DatabaseSync } from "node:sqlite";
import { nameKey } from "./data/common.ts";

// All database access goes through this module and src/data/: node:sqlite is still young, and keeping it in one place
// keeps a later switch (another driver, or Postgres when the app moves to a real server) small.
//
// SQL rules (see AGENTS.md): portable SQL only. UUIDs as TEXT, timestamps as ISO-8601 strings in UTC written by the app,
// booleans as INTEGER 0/1, no COLLATE NOCASE, never query inside JSON. The one deliberate exception is STRICT.

// One entry per schema version, applied in order and recorded in schema_migrations. Only ever append, never edit.
// A migration is SQL, or a function when it needs JS (v5 compares names the way the app does).
export type Migration = string | ((db: Db) => void);
export const MIGRATIONS: readonly Migration[] = [
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
  // v5: shared programs and one exercise catalog for everybody.
  (db) => {
    db.exec(V5_BEFORE_MERGE);
    mergeCatalogs(db);
    db.exec(V5_AFTER_MERGE);
  },
];

// exercise_test gets its owner (it was the owner of the exercise); nullable because SQLite cannot add a NOT NULL column
// with a reference, the app always sets it.
const V5_BEFORE_MERGE = `
  ALTER TABLE exercise_test ADD COLUMN user_id TEXT REFERENCES app_user(id) ON DELETE CASCADE;
  UPDATE exercise_test SET user_id = (SELECT e.user_id FROM exercise e WHERE e.id = exercise_test.exercise_id);
  DROP INDEX exercise_name;
  DROP INDEX exercise_alias_name;
`;

// exercise.user_id and exercise_alias.user_id stay as "created by": the catalog is shared, no query filters on them.
const V5_AFTER_MERGE = `
  CREATE UNIQUE INDEX exercise_name ON exercise(lower(name));
  CREATE UNIQUE INDEX exercise_alias_name ON exercise_alias(lower(alias));
  CREATE INDEX exercise_test_user ON exercise_test(user_id, exercise_id);

  ALTER TABLE program ADD COLUMN shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1));

  -- start date and archive flag are per user; program.start_date / archived are no longer read
  CREATE TABLE program_member (
    program_id TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (program_id, user_id)
  ) STRICT;
  CREATE INDEX program_member_user ON program_member(user_id);
  INSERT INTO program_member (program_id, user_id, start_date, archived, joined_at)
    SELECT id, user_id, start_date, archived, created_at FROM program;

  -- skipped is per user too; planned_session.skipped_at / skip_note are no longer read
  CREATE TABLE planned_session_skip (
    planned_session_id TEXT NOT NULL REFERENCES planned_session(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    skipped_at TEXT NOT NULL,
    skip_note TEXT,
    PRIMARY KEY (planned_session_id, user_id)
  ) STRICT;
  INSERT INTO planned_session_skip (planned_session_id, user_id, skipped_at, skip_note)
    SELECT ps.id, p.user_id, ps.skipped_at, ps.skip_note
    FROM planned_session ps JOIN program_week w ON w.id = ps.week_id JOIN program p ON p.id = w.program_id
    WHERE ps.skipped_at IS NOT NULL;
`;

type CatalogRow = { id: string; name: string; note: string | null; archived: number; created_at: string; has_weight: number; has_reps: number; has_distance: number; has_duration: number; user_id: string };

// Exercises of different users that share a name or alias (case ignored) become one: the oldest stays, fields are
// united, the others' names become aliases, and everything pointing at them is moved over.
function mergeCatalogs(db: Db): void {
  const exercises = db.prepare("SELECT * FROM exercise ORDER BY created_at, id").all() as CatalogRow[];
  const aliases = db.prepare("SELECT exercise_id, alias FROM exercise_alias").all() as { exercise_id: string; alias: string }[];
  const namesOf = new Map<string, string[]>();
  for (const e of exercises) namesOf.set(e.id, [e.name]);
  for (const a of aliases) namesOf.get(a.exercise_id)?.push(a.alias);

  // group by shared name keys (union-find over the exercises)
  const parent = new Map<string, string>(exercises.map((e) => [e.id, e.id]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  const owner = new Map<string, string>();
  for (const e of exercises) {
    for (const n of namesOf.get(e.id)!) {
      const other = owner.get(nameKey(n));
      if (other === undefined) owner.set(nameKey(n), e.id);
      else parent.set(root(e.id), root(other));
    }
  }
  const groups = new Map<string, CatalogRow[]>();
  for (const e of exercises) groups.set(root(e.id), [...(groups.get(root(e.id)) ?? []), e]);

  const repoint = [
    db.prepare("UPDATE block_exercise SET exercise_id = ? WHERE exercise_id = ?"),
    db.prepare("UPDATE planned_item SET exercise_id = ? WHERE exercise_id = ?"),
    db.prepare("UPDATE planned_item SET load_ref_exercise_id = ? WHERE load_ref_exercise_id = ?"),
    db.prepare("UPDATE exercise_test SET exercise_id = ? WHERE exercise_id = ?"),
  ];
  const addAlias = db.prepare("INSERT INTO exercise_alias (exercise_id, user_id, alias) VALUES (?, ?, ?)");
  for (const group of groups.values()) {
    const [keep, ...rest] = group as [CatalogRow, ...CatalogRow[]];
    if (rest.length === 0) continue;
    const flags = (k: "has_weight" | "has_reps" | "has_distance" | "has_duration") => (group.some((e) => e[k] === 1) ? 1 : 0);
    const names = new Map<string, string>(); // key -> text, the kept name first
    for (const e of group) for (const n of namesOf.get(e.id)!) if (!names.has(nameKey(n))) names.set(nameKey(n), n);
    names.delete(nameKey(keep.name));
    for (const e of rest) {
      db.prepare("DELETE FROM exercise_alias WHERE exercise_id = ?").run(e.id);
      for (const move of repoint) move.run(keep.id, e.id);
      db.prepare("DELETE FROM exercise WHERE id = ?").run(e.id);
    }
    db.prepare("DELETE FROM exercise_alias WHERE exercise_id = ?").run(keep.id);
    for (const alias of names.values()) addAlias.run(keep.id, keep.user_id, alias);
    db.prepare("UPDATE exercise SET has_weight = ?, has_reps = ?, has_distance = ?, has_duration = ?, note = ?, archived = ? WHERE id = ?").run(
      flags("has_weight"),
      flags("has_reps"),
      flags("has_distance"),
      flags("has_duration"),
      keep.note ?? group.find((e) => e.note)?.note ?? null,
      group.every((e) => e.archived === 1) ? 1 : 0,
      keep.id,
    );
  }
}

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
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS, now: () => string = isoNow): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT");
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  for (let version = (row.v ?? 0) + 1; version <= migrations.length; version++) {
    transaction(db, () => {
      const migration = migrations[version - 1]!;
      if (typeof migration === "function") migration(db);
      else db.exec(migration);
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
