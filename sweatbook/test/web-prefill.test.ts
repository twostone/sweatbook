import assert from "node:assert/strict";
import { test } from "node:test";
import { draftFor } from "../web/src/logic/prefill.ts";
import type { SessionExercise, SetLog } from "../web/src/types.ts";

const log = (weight_kg: number | null, reps: number | null, extra: Partial<SetLog> = {}): SetLog => ({
  id: crypto.randomUUID(),
  position: 1,
  weight_kg,
  reps,
  duration_s: null,
  distance_m: null,
  is_max: false,
  note: null,
  logged_at: "2026-10-24T11:00:00.000Z",
  ...extra,
});
const exercise = (sets: SetLog[], lastSets: SetLog[] | null): SessionExercise => ({
  id: "be",
  position: 1,
  exercise: { id: "e", name: "Kniebeuge", fields: ["weight", "reps"], archived: false },
  note: null,
  sets,
  planned: null,
  last_time: lastSets ? { session_id: "s0", started_at: "2026-10-17T11:00:00.000Z", sets: lastSets } : null,
});

test("the next set copies the previous one of this session", () => {
  assert.deepEqual(draftFor(exercise([log(100, 5), log(102.5, 3, { is_max: true, note: "x" })], [log(90, 5)])), {
    weight_kg: 102.5,
    reps: 3,
    duration_s: null,
    distance_m: null,
  });
});

test("the first set copies the first one of last time", () => {
  assert.deepEqual(draftFor(exercise([], [log(90, 5), log(95, 5)])), { weight_kg: 90, reps: 5, duration_s: null, distance_m: null });
});

test("nothing to copy gives an empty row", () => {
  assert.deepEqual(draftFor(exercise([], null)), { weight_kg: null, reps: null, duration_s: null, distance_m: null });
});

const planned = (over: Partial<NonNullable<SessionExercise["planned"]>>): SessionExercise["planned"] => ({
  id: "pi",
  position: 1,
  exercise: { id: "e", name: "Kniebeuge", fields: ["weight", "reps"] },
  label: null,
  sets: [4, 4],
  reps: [3, 5],
  distance_m: null,
  duration_s: null,
  to_max: false,
  load_kg: null,
  load_pct: 85,
  load_ref: null,
  weight_kg: 97.5,
  test_kind: null,
  rest: null,
  note: null,
  test: null,
  ...over,
});

test("planned sets left: the row starts with the plan (weight, upper bound of the reps), not the previous set", () => {
  const e = { ...exercise([log(95, 4)], [log(90, 5)]), planned: planned({}) };
  assert.deepEqual(draftFor(e), { weight_kg: 97.5, reps: 5, duration_s: null, distance_m: null });
});

test("a target the plan leaves open falls back to the usual rule", () => {
  const e = { ...exercise([log(45, 20)], null), planned: planned({ to_max: true, reps: null, weight_kg: 45 }) };
  assert.deepEqual(draftFor(e), { weight_kg: 45, reps: 20, duration_s: null, distance_m: null });
});

test("all planned sets done: back to the previous set", () => {
  const e = { ...exercise([log(97.5, 5), log(97.5, 4), log(97.5, 4), log(97.5, 3)], null), planned: planned({}) };
  assert.deepEqual(draftFor(e), { weight_kg: 97.5, reps: 3, duration_s: null, distance_m: null });
});
