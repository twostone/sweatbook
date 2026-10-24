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
    db.prepare("INSERT INTO exercise (id, user_id, name, metrics, archived, created_at) VALUES ('e', 'u', 'A', 'weight_reps', 'no', 'x')").run(),
  );
});
