import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuickEntry } from "../web/src/logic/quick-entry.ts";

const set = (weight_kg: number | null, reps: number | null, duration_s: number | null = null) => ({ weight_kg, reps, duration_s });

test("sets × reps @ kg", () => {
  assert.deepEqual(parseQuickEntry("3×5@100", "weight_reps"), [set(100, 5), set(100, 5), set(100, 5)]);
  assert.deepEqual(parseQuickEntry("2x8 @ 102,5", "weight_reps"), [set(102.5, 8), set(102.5, 8)]);
  assert.deepEqual(parseQuickEntry("2 * 8 @ 60kg", "weight_reps"), [set(60, 8), set(60, 8)]);
});

test("one set without a count, bodyweight without @", () => {
  assert.deepEqual(parseQuickEntry("5@100", "weight_reps"), [set(100, 5)]);
  assert.deepEqual(parseQuickEntry("3×10", "weight_reps"), [set(null, 10), set(null, 10), set(null, 10)]);
});

test("time exercises take the time like the time field", () => {
  assert.deepEqual(parseQuickEntry("3×45", "duration"), [set(null, null, 45), set(null, null, 45), set(null, null, 45)]);
  assert.deepEqual(parseQuickEntry("2×1:05", "duration"), [set(null, null, 65), set(null, null, 65)]);
  assert.deepEqual(parseQuickEntry("2×30@10", "weight_duration"), [set(10, null, 30), set(10, null, 30)]);
});

test("invalid input gives null", () => {
  for (const text of ["", "abc", "3×", "×5", "3×5@", "3×5@abc", "0×5", "21×5", "3×0", "3×5,5"]) {
    assert.equal(parseQuickEntry(text, "weight_reps"), null, text);
  }
  assert.equal(parseQuickEntry("3×45@10", "duration"), null, "plain time exercises have no weight");
  assert.equal(parseQuickEntry("3×190", "duration"), null);
});
