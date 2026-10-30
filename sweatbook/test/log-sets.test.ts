import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { InvalidError, NotFoundError } from "../src/data/common.ts";
import { createExercise, resolveExercise, updateExercise } from "../src/data/exercises.ts";
import { logSets } from "../src/data/log.ts";
import { createSession, findOpenSession, listSessions } from "../src/data/sessions.ts";
import { resolveUser } from "../src/data/users.ts";

function setup() {
  const db = openDb(":memory:");
  const uid = resolveUser(db, "ha-1", null).id;
  const squat = createExercise(db, uid, { name: "Kniebeuge", fields: ["weight", "reps"], aliases: ["Squat"] });
  return { db, uid, squat };
}
const count = (db: ReturnType<typeof openDb>, table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

test("resolveExercise: ID, name and alias in any case; unknown names are refused with similar ones", () => {
  const { db, uid, squat } = setup();
  assert.equal(resolveExercise(db, uid, squat.id).id, squat.id);
  assert.equal(resolveExercise(db, uid, "  kniebeuge ").id, squat.id);
  assert.equal(resolveExercise(db, uid, "SQUAT").id, squat.id);
  assert.throws(() => resolveExercise(db, uid, "Kniebeu"), (e: Error) => e instanceof InvalidError && e.message.includes("similar: Kniebeuge"));
  assert.throws(() => resolveExercise(db, uid, "Bankdrücken"), (e: Error) => e instanceof InvalidError && e.message.includes("create_exercise"));
  assert.throws(() => resolveExercise(db, uid, "00000000-0000-4000-8000-000000000000"), NotFoundError);
});

test("findOpenSession: the running session, none once ended", () => {
  const { db, uid } = setup();
  assert.equal(findOpenSession(db, uid), null);
  const open = createSession(db, uid, {});
  assert.equal(findOpenSession(db, uid)?.id, open.id);
  createSession(db, uid, { started_at: "2020-01-01T10:00:00Z", ended_at: "2020-01-01T11:00:00Z" });
  assert.equal(findOpenSession(db, uid)?.id, open.id);
});

test("logSets: no open session -> a new one; the next call joins the same block", () => {
  const { db, uid } = setup();
  const first = logSets(db, uid, { exercise: "Kniebeuge", sets: [{ weight_kg: 100, reps: 5 }] });
  assert.equal(first.blocks.length, 1);
  const second = logSets(db, uid, { exercise: "squat", sets: [{ weight_kg: 100, reps: 5 }, { weight_kg: 100, reps: 4 }] });
  assert.equal(second.id, first.id);
  assert.equal(second.blocks.length, 1);
  assert.equal(second.blocks[0]!.exercises[0]!.sets.length, 3);
  assert.equal(count(db, "session"), 1);
});

test("logSets: an explicit session is used, a foreign one is not found", () => {
  const { db, uid } = setup();
  const past = createSession(db, uid, { started_at: "2026-10-01T10:00:00Z", ended_at: "2026-10-01T11:00:00Z" });
  const open = createSession(db, uid, {});
  const tree = logSets(db, uid, { exercise: "Kniebeuge", sets: [{ weight_kg: 90, reps: 5 }], session_id: past.id });
  assert.equal(tree.id, past.id);
  assert.equal(findOpenSession(db, uid)?.id, open.id);
  const other = resolveUser(db, "ha-2", null).id;
  assert.throws(() => logSets(db, other, { exercise: "Kniebeuge", sets: [{ reps: 5 }], session_id: past.id }), NotFoundError);
});

test("logSets: a refused call changes nothing", () => {
  const { db, uid, squat } = setup();
  assert.throws(() => logSets(db, uid, { exercise: "Unbekannt", sets: [{ reps: 5 }] }), InvalidError);
  assert.throws(() => logSets(db, uid, { exercise: "Kniebeuge", sets: [{ weight_kg: 100 }] }), InvalidError); // no reps
  assert.throws(() => logSets(db, uid, { exercise: "Kniebeuge", sets: [{ reps: 5, duration_s: 30 }] }), InvalidError); // field not allowed
  updateExercise(db, uid, squat.id, { archived: true });
  assert.throws(() => logSets(db, uid, { exercise: "Kniebeuge", sets: [{ reps: 5 }] }));
  assert.equal(count(db, "session"), 0);
  assert.equal(count(db, "block"), 0);
  assert.equal(listSessions(db, uid).length, 0);
});
