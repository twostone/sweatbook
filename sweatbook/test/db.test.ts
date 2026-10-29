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
  migrate(db, MIGRATIONS.slice(0, 4));
  assert.equal(schemaVersion(db), 4);
  assert.deepEqual({ ...db.prepare("SELECT planned_session_id FROM session").get() }, { planned_session_id: null });
  assert.deepEqual({ ...db.prepare("SELECT planned_item_id FROM block_exercise").get() }, { planned_item_id: null });
  assert.deepEqual({ ...db.prepare("SELECT COUNT(*) AS n FROM program").get() }, { n: 0 });
});

test("migration v5: week phase texts become one phase per program and name, the old column stays", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, MIGRATIONS.slice(0, 4));
  db.exec(`
    INSERT INTO app_user (id, ha_user_id, created_at) VALUES ('u', 'ha', 'x');
    INSERT INTO program (id, user_id, name, start_date, created_at) VALUES ('p1', 'u', 'Eins', '2026-01-05', 'x'), ('p2', 'u', 'Zwei', '2026-01-05', 'x');
    INSERT INTO program_week (id, program_id, number, phase) VALUES
      ('w1', 'p1', 1, 'Aufbau'), ('w2', 'p1', 2, 'aufbau'), ('w3', 'p1', 3, 'Test'), ('w4', 'p1', 4, NULL), ('w5', 'p1', 5, 'Aufbau'),
      ('v1', 'p2', 1, 'Aufbau');
  `);
  migrate(db, MIGRATIONS.slice(0, 5));
  assert.equal(schemaVersion(db), 5);
  const weeks = db
    .prepare("SELECT w.id, p.name, p.program_id, w.phase FROM program_week w LEFT JOIN program_phase p ON p.id = w.phase_id ORDER BY w.id")
    .all()
    .map((r) => ({ ...r }));
  assert.deepEqual(weeks, [
    { id: "v1", name: "Aufbau", program_id: "p2", phase: "Aufbau" },
    { id: "w1", name: "Aufbau", program_id: "p1", phase: "Aufbau" },
    { id: "w2", name: "Aufbau", program_id: "p1", phase: "aufbau" },
    { id: "w3", name: "Test", program_id: "p1", phase: "Test" },
    { id: "w4", name: null, program_id: null, phase: null },
    { id: "w5", name: "Aufbau", program_id: "p1", phase: "Aufbau" },
  ]);
  const same = db.prepare("SELECT COUNT(DISTINCT phase_id) AS n FROM program_week WHERE id IN ('w1', 'w2', 'w5')").get() as { n: number };
  assert.equal(same.n, 1);
  assert.deepEqual({ ...db.prepare("SELECT COUNT(*) AS n FROM program_phase").get() }, { n: 3 });
});

test("migration v6: catalogs of all users merge, programs get members and skips", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, MIGRATIONS.slice(0, 5));
  db.exec(`
    INSERT INTO app_user (id, ha_user_id, created_at) VALUES ('anna', 'ha1', 'x'), ('ben', 'ha2', 'x');
    INSERT INTO exercise (id, user_id, name, has_weight, has_reps, note, created_at) VALUES
      ('ea', 'anna', 'Kniebeuge', 1, 1, NULL, '1'), ('eb', 'ben', 'kniebeuge', 1, 0, 'tief', '2'),
      ('eb2', 'ben', 'Übung', 0, 1, NULL, '3'), ('ea2', 'anna', 'ÜBUNG', 0, 1, NULL, '4'),
      ('ec', 'ben', 'Klimmzug', 0, 1, NULL, '5');
    INSERT INTO exercise_alias (exercise_id, user_id, alias) VALUES ('eb', 'ben', 'Squat'), ('ec', 'ben', 'Kniebeuge');
    INSERT INTO session (id, user_id, started_at, created_at) VALUES ('s', 'ben', 'x', 'x');
    INSERT INTO block (id, session_id, position, type) VALUES ('b', 's', 0, 'straight');
    INSERT INTO block_exercise (id, block_id, exercise_id, position) VALUES ('be', 'b', 'eb', 0);
    INSERT INTO exercise_test (id, exercise_id, tested_on, kind, weight_kg) VALUES ('t', 'eb', '2026-10-01', 'one_rm', 100);
    INSERT INTO program (id, user_id, name, start_date, archived, created_at) VALUES ('p', 'anna', 'Plan', '2026-10-05', 1, 'x');
    INSERT INTO program_week (id, program_id, number) VALUES ('w', 'p', 1);
    INSERT INTO planned_session (id, week_id, position, label, skipped_at, skip_note) VALUES ('ps', 'w', 0, 'A', 'y', 'krank'), ('ps2', 'w', 1, 'B', NULL, NULL);
    INSERT INTO planned_item (id, planned_session_id, position, exercise_id, load_pct, load_ref_exercise_id) VALUES ('pi', 'ps', 0, 'ea', 80, 'eb');
  `);
  migrate(db);
  const names = db.prepare("SELECT id, name, has_weight, has_reps, note FROM exercise ORDER BY created_at").all().map((r) => ({ ...r }));
  // Kniebeuge, kniebeuge and Klimmzug (alias Kniebeuge) are one; Übung and ÜBUNG too
  assert.deepEqual(names, [
    { id: "ea", name: "Kniebeuge", has_weight: 1, has_reps: 1, note: "tief" },
    { id: "eb2", name: "Übung", has_weight: 0, has_reps: 1, note: null },
  ]);
  const aliases = db.prepare("SELECT exercise_id, alias FROM exercise_alias ORDER BY alias").all().map((r) => ({ ...r }));
  assert.deepEqual(aliases, [{ exercise_id: "ea", alias: "Klimmzug" }, { exercise_id: "ea", alias: "Squat" }]);
  assert.deepEqual({ ...db.prepare("SELECT exercise_id FROM block_exercise").get() }, { exercise_id: "ea" });
  assert.deepEqual({ ...db.prepare("SELECT exercise_id, user_id FROM exercise_test").get() }, { exercise_id: "ea", user_id: "ben" });
  assert.deepEqual({ ...db.prepare("SELECT exercise_id, load_ref_exercise_id FROM planned_item").get() }, { exercise_id: "ea", load_ref_exercise_id: "ea" });
  assert.deepEqual({ ...db.prepare("SELECT user_id, start_date, archived FROM program_member").get() }, { user_id: "anna", start_date: "2026-10-05", archived: 1 });
  assert.deepEqual({ ...db.prepare("SELECT planned_session_id, user_id, skip_note FROM planned_session_skip").get() }, { planned_session_id: "ps", user_id: "anna", skip_note: "krank" });
  assert.deepEqual({ ...db.prepare("SELECT shared FROM program").get() }, { shared: 0 });
});
