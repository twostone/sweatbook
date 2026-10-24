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
  is_max: false,
  note: null,
  logged_at: "2026-10-24T11:00:00.000Z",
  ...extra,
});
const exercise = (sets: SetLog[], lastSets: SetLog[] | null): SessionExercise => ({
  id: "be",
  position: 1,
  exercise: { id: "e", name: "Kniebeuge", metrics: "weight_reps", archived: false },
  note: null,
  sets,
  last_time: lastSets ? { session_id: "s0", started_at: "2026-10-17T11:00:00.000Z", sets: lastSets } : null,
});

test("the next set copies the previous one of this session", () => {
  assert.deepEqual(draftFor(exercise([log(100, 5), log(102.5, 3, { is_max: true, note: "x" })], [log(90, 5)])), {
    weight_kg: 102.5,
    reps: 3,
    duration_s: null,
  });
});

test("the first set copies the first one of last time", () => {
  assert.deepEqual(draftFor(exercise([], [log(90, 5), log(95, 5)])), { weight_kg: 90, reps: 5, duration_s: null });
});

test("nothing to copy gives an empty row", () => {
  assert.deepEqual(draftFor(exercise([], null)), { weight_kg: null, reps: null, duration_s: null });
});
