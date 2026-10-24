import assert from "node:assert/strict";
import { test } from "node:test";
import { formatKg, formatSessionDate, formatSet, summarize } from "../web/src/logic/format.ts";
import type { SetLog } from "../web/src/types.ts";

const log = (weight_kg: number | null, reps: number | null, duration_s: number | null = null, is_max = false): SetLog => ({
  id: "x",
  position: 1,
  weight_kg,
  reps,
  duration_s,
  is_max,
  note: null,
  logged_at: "2026-10-24T11:00:00.000Z",
});

test("kg with a German comma", () => {
  assert.equal(formatKg(102.5), "102,5");
  assert.equal(formatKg(100), "100");
  assert.equal(formatKg(80.25), "80,25");
});

test("one set", () => {
  assert.equal(formatSet(log(100, 5), "weight_reps"), "100 kg × 5");
  assert.equal(formatSet(log(null, 10), "weight_reps"), "KG × 10");
  assert.equal(formatSet(log(null, null, 65, true), "duration"), "1:05 MAX");
  assert.equal(formatSet(log(10, null, 30), "weight_duration"), "0:30 @ 10 kg");
});

test("summary of an exercise's sets", () => {
  assert.equal(summarize([log(100, 5), log(100, 5), log(100, 5)], "weight_reps"), "3 × 5 @ 100 kg");
  assert.equal(summarize([log(100, 5), log(102.5, 5), log(102.5, 5)], "weight_reps"), "3 × 5 · bis 102,5 kg");
  assert.equal(summarize([log(80, 8), log(80, 7)], "weight_reps"), "80 kg × 8, 7");
  assert.equal(summarize([log(null, 10), log(null, 9)], "weight_reps"), "KG × 10, 9");
  assert.equal(summarize([log(100, 5), log(90, 8)], "weight_reps"), "100 kg × 5, 90 kg × 8");
  assert.equal(summarize([log(80, 8), log(82.5, 6), log(82.5, 5), log(85, 3, null, true)], "weight_reps"), "4 Sätze · bis 85 kg MAX");
  assert.equal(summarize([log(null, 8), log(10, 6), log(null, 5), log(null, 3)], "weight_reps"), "4 Sätze · bis 10 kg");
  assert.equal(summarize([log(null, null, 30), log(null, null, 45), log(null, null, 50), log(null, null, 20)], "duration"), "4 Sätze · bis 0:50");
  assert.equal(summarize([log(null, null, 65, true)], "duration"), "1:05 MAX");
  assert.equal(summarize([log(null, null, 45), log(null, null, 45)], "duration"), "2 × 0:45");
  assert.equal(summarize([], "weight_reps"), "");
});

test("session date in German, local time", () => {
  assert.equal(formatSessionDate("2026-10-24T11:40:00.000Z", "Europe/Berlin"), "Sa 24. Okt · 13:40");
});
