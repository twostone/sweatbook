import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { addBlock } from "../src/data/blocks.ts";
import { createExercise } from "../src/data/exercises.ts";
import { createSession } from "../src/data/sessions.ts";
import { addSets, type SetInput } from "../src/data/sets.ts";
import { estimatedOneRm, exerciseProgress, MAX_PERIOD_DAYS, periodSummary, topSet, trainingSummary, volumeOf } from "../src/data/stats.ts";
import { resolveUser } from "../src/data/users.ts";
import { InvalidError, NotFoundError } from "../src/data/common.ts";
import { muscleSummary, noMuscles, replaceRoles, type Muscles } from "../src/data/muscles.ts";
import { updateExercise } from "../src/data/exercises.ts";

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

test("muscleSummary: a set counts 1 per primary and 0.5 per secondary muscle, untagged sets are counted apart", () => {
  const muscles = new Map<string, Muscles>([
    ["bench", { primary: ["chest"], secondary: ["front_delts", "triceps"] }],
    ["dips", { primary: ["triceps", "chest"], secondary: [] }],
  ]);
  const sets = [{ exercise_id: "bench" }, { exercise_id: "bench" }, { exercise_id: "dips" }, { exercise_id: "plank" }];
  const summary = muscleSummary(sets, (id) => muscles.get(id) ?? noMuscles());
  assert.deepEqual(summary, {
    muscles: [
      { muscle: "chest", sets: 3, primary_sets: 3, secondary_sets: 0 },
      { muscle: "triceps", sets: 2, primary_sets: 1, secondary_sets: 2 },
      { muscle: "front_delts", sets: 1, primary_sets: 0, secondary_sets: 2 },
    ],
    untagged_sets: 1,
  });
  assert.deepEqual(muscleSummary([], () => noMuscles()), { muscles: [], untagged_sets: 0 });
});

test("replaceRoles: a given list replaces its role and takes its groups from the other one", () => {
  const current: Muscles = { primary: ["chest"], secondary: ["front_delts", "triceps"] };
  assert.equal(replaceRoles(current), undefined);
  assert.deepEqual(replaceRoles(current, ["chest", "triceps"]), { primary: ["chest", "triceps"], secondary: ["front_delts"] });
  assert.deepEqual(replaceRoles(current, undefined, ["chest"]), { primary: [], secondary: ["chest"] });
  assert.deepEqual(replaceRoles(current, [], []), { primary: [], secondary: [] });
});

test("trainingSummary: weighted sets per muscle group per week", () => {
  const { db, uid, squat, dips, train } = setup();
  updateExercise(db, uid, squat.id, { muscles: { primary: ["quads"], secondary: ["glutes"] } });
  train(squat.id, at(10, 26), [{ weight_kg: 100, reps: 5 }, { weight_kg: 100, reps: 5 }]);
  train(dips.id, at(10, 27), [{ reps: 10 }]);
  const { weeks } = trainingSummary(db, uid, { weeks: 2, now: NOW });
  assert.deepEqual(weeks[0]!.muscles, { muscles: [], untagged_sets: 0 });
  assert.deepEqual(weeks[1]!.muscles, {
    muscles: [
      { muscle: "quads", sets: 2, primary_sets: 2, secondary_sets: 0 },
      { muscle: "glutes", sets: 1, primary_sets: 0, secondary_sets: 2 },
    ],
    untagged_sets: 1,
  });
});

test("periodSummary: both ends included, local days, only the asking user's sets", () => {
  const { db, uid, squat, dips, train } = setup();
  updateExercise(db, uid, squat.id, { muscles: { primary: ["quads"], secondary: ["glutes"] } });
  train(squat.id, at(10, 19), [{ weight_kg: 100, reps: 5 }]); // day before `from`
  train(squat.id, at(10, 20), [{ weight_kg: 100, reps: 5 }, { weight_kg: 100, reps: 5 }]); // `from`
  train(dips.id, at(10, 27), [{ reps: 10 }]); // `to`
  train(squat.id, at(10, 28), [{ weight_kg: 100, reps: 5 }]); // day after `to`
  train(squat.id, at(10, 22), [{ weight_kg: 50, reps: 5 }], resolveUser(db, "ha-2", null).id);
  const p = periodSummary(db, uid, { from: "2026-10-20", to: "2026-10-27" });
  assert.deepEqual([p.from, p.to, p.days, p.sessions, p.sets, p.volume_kg], ["2026-10-20", "2026-10-27", 8, 2, 3, 1000]);
  assert.deepEqual(p.muscles, {
    muscles: [
      { muscle: "quads", sets: 2, primary_sets: 2, secondary_sets: 0 },
      { muscle: "glutes", sets: 1, primary_sets: 0, secondary_sets: 2 },
    ],
    untagged_sets: 1,
  });
  assert.equal(periodSummary(db, uid, { from: "2026-10-27", to: "2026-10-27" }).sets, 1, "a single day");
});

test("periodSummary: two whole weeks add up to the weeks of trainingSummary", () => {
  const { db, uid, squat, dips, train } = setup();
  updateExercise(db, uid, squat.id, { muscles: { primary: ["quads"], secondary: [] } });
  train(squat.id, at(10, 19), [{ weight_kg: 100, reps: 5 }]); // Monday last week
  train(dips.id, at(10, 25), [{ reps: 10 }]); // Sunday last week
  train(squat.id, at(10, 29), [{ weight_kg: 90, reps: 3 }, { weight_kg: 90, reps: 3 }]); // this week
  const { weeks } = trainingSummary(db, uid, { weeks: 2, now: NOW });
  const p = periodSummary(db, uid, { from: "2026-10-19", to: "2026-11-01" });
  assert.equal(p.sets, weeks[0]!.sets + weeks[1]!.sets);
  assert.equal(p.volume_kg, weeks[0]!.volume_kg + weeks[1]!.volume_kg);
  assert.equal(p.muscles.muscles[0]!.sets, weeks[0]!.muscles.muscles[0]!.sets + weeks[1]!.muscles.muscles[0]!.sets);
  assert.equal(p.muscles.untagged_sets, 1);
});

test("periodSummary: from after to and too long spans are refused", () => {
  const { db, uid } = setup();
  assert.throws(() => periodSummary(db, uid, { from: "2026-10-28", to: "2026-10-27" }), InvalidError);
  assert.throws(() => periodSummary(db, uid, { from: "2025-01-01", to: "2026-01-02" }), InvalidError);
  assert.equal(periodSummary(db, uid, { from: "2026-01-01", to: "2026-12-31" }).days, 365);
  assert.equal(MAX_PERIOD_DAYS, 366);
});
