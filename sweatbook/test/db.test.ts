import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";

test("migrations: fresh database is at the latest version, recorded in schema_migrations", () => {
  const db = openDb(":memory:");
  assert.equal(schemaVersion(db), MIGRATIONS.length);
  const rows = db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all() as { version: number; applied_at: string }[];
  assert.deepEqual(rows.map((r) => r.version), MIGRATIONS.map((_, i) => i + 1));
  assert.match(rows[0]!.applied_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
});

test("migrations: running again changes nothing, only new entries are applied", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, ["CREATE TABLE a (x INTEGER) STRICT"]);
  migrate(db, ["CREATE TABLE a (x INTEGER) STRICT"]);
  migrate(db, ["CREATE TABLE a (x INTEGER) STRICT", "CREATE TABLE b (y INTEGER) STRICT"]);
  assert.equal(schemaVersion(db), 2);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get());
});

test("migrations: a failing migration is rolled back and not recorded", () => {
  const db = new DatabaseSync(":memory:");
  assert.throws(() => migrate(db, ["CREATE TABLE a (x INTEGER) STRICT; CREATE TABLE a (y INTEGER)"]));
  assert.equal(schemaVersion(db), 0);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").get(), undefined);
});

test("schema: foreign keys are enforced and STRICT rejects wrong types", () => {
  const db = openDb(":memory:");
  assert.throws(() =>
    db.prepare("INSERT INTO session (id, user_id, started_at, created_at) VALUES ('s', 'nobody', 'x', 'x')").run(),
  );
  db.prepare("INSERT INTO app_user (id, ha_user_id, created_at) VALUES ('u', 'ha', 'x')").run();
  assert.throws(() =>
    db.prepare("INSERT INTO exercise (id, user_id, name, has_reps, archived, created_at) VALUES ('e', 'u', 'A', 1, 'no', 'x')").run(),
  );
});

test("migration v2: existing block exercises keep their data and get an empty note", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, MIGRATIONS.slice(0, 1));
  db.exec(`
    INSERT INTO app_user (id, ha_user_id, created_at) VALUES ('u', 'ha', 'x');
    INSERT INTO exercise (id, user_id, name, metrics, created_at) VALUES ('e', 'u', 'A', 'weight_reps', 'x');
    INSERT INTO session (id, user_id, started_at, created_at) VALUES ('s', 'u', 'x', 'x');
    INSERT INTO block (id, session_id, position, type) VALUES ('b', 's', 0, 'straight');
    INSERT INTO block_exercise (id, block_id, exercise_id, position) VALUES ('be', 'b', 'e', 0);
  `);
  migrate(db, MIGRATIONS.slice(0, 2));
  assert.equal(schemaVersion(db), 2);
  assert.deepEqual({ ...db.prepare("SELECT id, exercise_id, note FROM block_exercise").get() }, { id: "be", exercise_id: "e", note: null });
});

test("migration v3: the three old kinds become field flags, sets keep their values and get an empty distance", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, MIGRATIONS.slice(0, 2));
  db.exec(`
    INSERT INTO app_user (id, ha_user_id, created_at) VALUES ('u', 'ha', 'x');
    INSERT INTO exercise (id, user_id, name, metrics, created_at) VALUES
      ('wr', 'u', 'Kniebeuge', 'weight_reps', 'x'), ('d', 'u', 'Deadhang', 'duration', 'x'), ('wd', 'u', 'Weste', 'weight_duration', 'x');
    INSERT INTO session (id, user_id, started_at, created_at) VALUES ('s', 'u', 'x', 'x');
    INSERT INTO block (id, session_id, position, type) VALUES ('b', 's', 0, 'straight');
    INSERT INTO block_exercise (id, block_id, exercise_id, position) VALUES ('be', 'b', 'wr', 0);
    INSERT INTO set_log (id, block_exercise_id, position, weight_kg, reps, logged_at) VALUES ('l', 'be', 0, 100, 5, 'x');
  `);
  migrate(db, MIGRATIONS.slice(0, 3));
  assert.equal(schemaVersion(db), 3);
  const flags = db.prepare("SELECT id, has_weight, has_reps, has_distance, has_duration FROM exercise ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(flags, [
    { id: "d", has_weight: 0, has_reps: 0, has_distance: 0, has_duration: 1 },
    { id: "wd", has_weight: 1, has_reps: 0, has_distance: 0, has_duration: 1 },
    { id: "wr", has_weight: 1, has_reps: 1, has_distance: 0, has_duration: 0 },
  ]);
  const columns = (db.prepare("PRAGMA table_info(exercise)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(!columns.includes("metrics"));
  assert.deepEqual({ ...db.prepare("SELECT weight_kg, reps, distance_m FROM set_log").get() }, { weight_kg: 100, reps: 5, distance_m: null });
});

test("migration v4: existing data stays, sessions and block exercises get no plan link", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, MIGRATIONS.slice(0, 3));
  db.exec(`
    INSERT INTO app_user (id, ha_user_id, created_at) VALUES ('u', 'ha', 'x');
    INSERT INTO exercise (id, user_id, name, has_weight, has_reps, created_at) VALUES ('e', 'u', 'A', 1, 1, 'x');
    INSERT INTO session (id, user_id, started_at, created_at) VALUES ('s', 'u', 'x', 'x');
    INSERT INTO block (id, session_id, position, type) VALUES ('b', 's', 0, 'straight');
    INSERT INTO block_exercise (id, block_id, exercise_id, position) VALUES ('be', 'b', 'e', 0);
  `);
  migrate(db);
  assert.equal(schemaVersion(db), 4);
  assert.deepEqual({ ...db.prepare("SELECT planned_session_id FROM session").get() }, { planned_session_id: null });
  assert.deepEqual({ ...db.prepare("SELECT planned_item_id FROM block_exercise").get() }, { planned_item_id: null });
  assert.deepEqual({ ...db.prepare("SELECT COUNT(*) AS n FROM program").get() }, { n: 0 });
});
