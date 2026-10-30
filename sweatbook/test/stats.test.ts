import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { addBlock } from "../src/data/blocks.ts";
import { createExercise } from "../src/data/exercises.ts";
import { createSession } from "../src/data/sessions.ts";
import { addSets, type SetInput } from "../src/data/sets.ts";
import { estimatedOneRm, exerciseProgress, topSet, trainingSummary, volumeOf } from "../src/data/stats.ts";
import { resolveUser } from "../src/data/users.ts";
import { NotFoundError } from "../src/data/common.ts";

const NOW = new Date(2026, 9, 30, 12, 0, 0); // Friday, local time like the data
// Local noon of a day, as the ISO string the API stores.
const at = (month: number, day: number) => new Date(2026, month - 1, day, 12, 0, 0).toISOString();

function setup() {
  const db = openDb(":memory:");
  const uid = resolveUser(db, "ha-1", null).id;
  const squat = createExercise(db, uid, { name: "Kniebeuge", fields: ["weight", "reps"] });
  const dips = createExercise(db, uid, { name: "Dips", fields: ["reps"] });
  const train = (exerciseId: string, startedAt: string, sets: SetInput[], user = uid) => {
    const session = createSession(db, user, { started_at: startedAt, ended_at: startedAt });
    const tree = addBlock(db, user, session.id, exerciseId);
    addSets(db, user, tree.blocks[0]!.exercises[0]!.id, sets);
    return session.id;
  };
  return { db, uid, squat, dips, train };
}

test("estimatedOneRm: Epley for 1-12 reps, rounded to 0.5 kg, nothing for bodyweight or high reps", () => {
  const set = (weight_kg: number | null, reps: number | null) => ({ weight_kg, reps, duration_s: null, distance_m: null });
  assert.equal(estimatedOneRm(set(100, 1)), 100);
  assert.equal(estimatedOneRm(set(100, 5)), 116.5); // 116.67 -> 116.5
  assert.equal(estimatedOneRm(set(100, 12)), 140);
  assert.equal(estimatedOneRm(set(100, 13)), null);
  assert.equal(estimatedOneRm(set(null, 8)), null);
  assert.equal(estimatedOneRm(set(100, null)), null);
});

test("volume and top set: bodyweight adds no volume, the heaviest then most reps wins", () => {
  const s = (weight_kg: number | null, reps: number | null) => ({ weight_kg, reps, duration_s: null, distance_m: null });
  assert.equal(volumeOf([s(100, 5), s(80, 8), s(null, 10)]), 1140);
  assert.deepEqual(topSet([s(100, 3), s(100, 5), s(90, 8)]), s(100, 5));
  assert.equal(topSet([]), null);
});

test("trainingSummary: weeks start on Monday, empty weeks are listed, sessions are counted once", () => {
  const { db, uid, squat, dips, train } = setup();
  train(squat.id, at(10, 26), [{ weight_kg: 100, reps: 5 }, { weight_kg: 100, reps: 5 }]); // Monday this week
  train(dips.id, at(10, 25), [{ reps: 10 }]); // Sunday: last week
  train(squat.id, at(10, 5), [{ weight_kg: 90, reps: 5 }]); // three weeks back
  const { weeks } = trainingSummary(db, uid, { weeks: 4, now: NOW });
  assert.deepEqual(weeks.map((w) => w.week_start), ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  assert.deepEqual(weeks.map((w) => [w.sessions, w.sets, w.volume_kg]), [[1, 1, 450], [0, 0, 0], [1, 1, 0], [1, 2, 1000]]);
  assert.deepEqual(weeks[3]!.exercises, [{ exercise_id: squat.id, name: "Kniebeuge", sets: 2, volume_kg: 1000 }]);
});

test("trainingSummary: only the asking user's sets count, older sets are left out", () => {
  const { db, uid, squat, train } = setup();
  const other = resolveUser(db, "ha-2", null).id;
  train(squat.id, at(10, 27), [{ weight_kg: 50, reps: 5 }], other);
  train(squat.id, at(9, 1), [{ weight_kg: 50, reps: 5 }]);
  assert.equal(trainingSummary(db, uid, { weeks: 2, now: NOW }).weeks.reduce((n, w) => n + w.sets, 0), 0);
});

test("exerciseProgress: one entry per session, newest first, with the best estimate", () => {
  const { db, uid, squat, train } = setup();
  const older = train(squat.id, at(10, 12), [{ weight_kg: 100, reps: 5 }, { weight_kg: 110, reps: 3 }]);
  const newer = train(squat.id, at(10, 26), [{ weight_kg: 105, reps: 5 }]);
  const p = exerciseProgress(db, uid, squat.id, { weeks: 4, now: NOW });
  assert.deepEqual(p.sessions.map((s) => s.session_id), [newer, older]);
  assert.equal(p.sessions[1]!.top_set?.weight_kg, 110);
  assert.equal(p.sessions[1]!.volume_kg, 830);
  assert.equal(p.sessions[0]!.est_1rm_kg, 122.5);
  assert.equal(p.best_est_1rm_kg, 122.5);
  // the catalog is shared, the sets are not
  assert.deepEqual(exerciseProgress(db, resolveUser(db, "ha-2", null).id, squat.id, { weeks: 4, now: NOW }).sessions, []);
  assert.throws(() => exerciseProgress(db, uid, "00000000-0000-4000-8000-000000000000"), NotFoundError);
});
