import assert from "node:assert/strict";
import { test } from "node:test";
import { formatKg, formatSessionDate, formatSet, summarize } from "../web/src/logic/format.ts";
import type { Field, SetLog } from "../web/src/types.ts";

const WR: Field[] = ["weight", "reps"];
const D: Field[] = ["duration"];
const WD: Field[] = ["weight", "duration"];
const FARMER: Field[] = ["weight", "distance", "duration"];

const log = (weight_kg: number | null, reps: number | null, duration_s: number | null = null, is_max = false, distance_m: number | null = null): SetLog => ({
  id: "x",
  position: 1,
  weight_kg,
  reps,
  duration_s,
  distance_m,
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
  assert.equal(formatSet(log(100, 5), WR), "100 kg × 5");
  assert.equal(formatSet(log(null, 10), WR), "KG × 10");
  assert.equal(formatSet(log(null, null, 65, true), D), "1:05 MAX");
  assert.equal(formatSet(log(10, null, 30), WD), "0:30 @ 10 kg");
});

test("several value fields, distance", () => {
  assert.equal(formatSet(log(24, null, 45, false, 60), FARMER), "60 m · 0:45 @ 24 kg");
  assert.equal(formatSet(log(null, null, null, false, 60), FARMER), "60 m");
  assert.equal(formatSet(log(null, 12, null), ["reps"]), "12 Wdh.");
  assert.equal(formatSet(log(100, 5, 45), ["weight", "reps", "duration"]), "5 Wdh. · 0:45 @ 100 kg");
  assert.equal(formatSet(log(100, 5, null), ["weight", "reps", "duration"]), "100 kg × 5", "only reps filled reads as before");
  assert.equal(summarize([log(24, null, 45, false, 60), log(24, null, 50, false, 60)], FARMER), "60 m · 0:45 @ 24 kg, 60 m · 0:50 @ 24 kg");
  assert.equal(
    summarize([log(24, null, 45, false, 60), log(24, null, 50, false, 60), log(32, null, 40, false, 60), log(24, null, 55, false, 60)], FARMER),
    "4 Sätze · bis 32 kg",
  );
  assert.equal(summarize([log(null, null, null, false, 60), log(null, null, null, false, 60), log(null, null, null, false, 60)], ["distance"]), "3 × 60 m");
});

test("summary of an exercise's sets", () => {
  assert.equal(summarize([log(100, 5), log(100, 5), log(100, 5)], WR), "3 × 5 @ 100 kg");
  assert.equal(summarize([log(100, 5), log(102.5, 5), log(102.5, 5)], WR), "3 × 5 · bis 102,5 kg");
  assert.equal(summarize([log(80, 8), log(80, 7)], WR), "80 kg × 8, 7");
  assert.equal(summarize([log(null, 10), log(null, 9)], WR), "KG × 10, 9");
  assert.equal(summarize([log(100, 5), log(90, 8)], WR), "100 kg × 5, 90 kg × 8");
  assert.equal(summarize([log(80, 8), log(82.5, 6), log(82.5, 5), log(85, 3, null, true)], WR), "4 Sätze · bis 85 kg MAX");
  assert.equal(summarize([log(null, 8), log(10, 6), log(null, 5), log(null, 3)], WR), "4 Sätze · bis 10 kg");
  assert.equal(summarize([log(null, null, 30), log(null, null, 45), log(null, null, 50), log(null, null, 20)], D), "4 Sätze · bis 0:50");
  assert.equal(summarize([log(null, null, 65, true)], D), "1:05 MAX");
  assert.equal(summarize([log(null, null, 45), log(null, null, 45)], D), "2 × 0:45");
  assert.equal(summarize([], WR), "");
});

test("session date in German, local time", () => {
  assert.equal(formatSessionDate("2026-10-24T11:40:00.000Z", "Europe/Berlin"), "Sa 24. Okt · 13:40");
});
