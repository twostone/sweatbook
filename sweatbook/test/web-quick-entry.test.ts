import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuickEntry, quickEntryExample, quickEntryField } from "../web/src/logic/quick-entry.ts";
import type { Field } from "../web/src/types.ts";

const WR: Field[] = ["weight", "reps"];
const D: Field[] = ["duration"];
const WD: Field[] = ["weight", "duration"];
const set = (weight_kg: number | null, reps: number | null, duration_s: number | null = null, distance_m: number | null = null) => ({
  weight_kg,
  reps,
  duration_s,
  distance_m,
});

test("sets × reps @ kg", () => {
  assert.deepEqual(parseQuickEntry("3×5@100", WR), [set(100, 5), set(100, 5), set(100, 5)]);
  assert.deepEqual(parseQuickEntry("2x8 @ 102,5", WR), [set(102.5, 8), set(102.5, 8)]);
  assert.deepEqual(parseQuickEntry("2 * 8 @ 60kg", WR), [set(60, 8), set(60, 8)]);
});

test("one set without a count, bodyweight without @", () => {
  assert.deepEqual(parseQuickEntry("5@100", WR), [set(100, 5)]);
  assert.deepEqual(parseQuickEntry("3×10", WR), [set(null, 10), set(null, 10), set(null, 10)]);
});

test("time exercises take the time like the time field", () => {
  assert.deepEqual(parseQuickEntry("3×45", D), [set(null, null, 45), set(null, null, 45), set(null, null, 45)]);
  assert.deepEqual(parseQuickEntry("2×1:05", D), [set(null, null, 65), set(null, null, 65)]);
  assert.deepEqual(parseQuickEntry("2×30@10", WD), [set(10, null, 30), set(10, null, 30)]);
});

test("invalid input gives null", () => {
  for (const text of ["", "abc", "3×", "×5", "3×5@", "3×5@abc", "0×5", "21×5", "3×0", "3×5,5"]) {
    assert.equal(parseQuickEntry(text, WR), null, text);
  }
  assert.equal(parseQuickEntry("3×45@10", D), null, "plain time exercises have no weight");
  assert.equal(parseQuickEntry("3×190", D), null);
});

test("distance takes whole metres, with or without m", () => {
  assert.deepEqual(parseQuickEntry("3×60m@24", ["weight", "distance"]), [set(24, null, null, 60), set(24, null, null, 60), set(24, null, null, 60)]);
  assert.deepEqual(parseQuickEntry("400", ["distance"]), [set(null, null, null, 400)]);
  assert.equal(parseQuickEntry("2×60@24", ["distance"]), null, "no weight field");
});

test("quick entry only for exercises with exactly one value field", () => {
  assert.equal(quickEntryField(WR), "reps");
  assert.equal(quickEntryField(["weight", "distance", "duration"]), null);
  assert.equal(parseQuickEntry("3×60", ["weight", "distance", "duration"]), null);
});

test("the example fits the exercise, and parses itself", () => {
  const cases: Field[][] = [WR, ["reps"], D, WD, ["distance"], ["weight", "distance"]];
  for (const fields of cases) {
    const example = quickEntryExample(fields)!;
    assert.ok(parseQuickEntry(example, fields), `${example} for ${fields.join("+")}`);
  }
  assert.equal(quickEntryExample(["weight", "distance", "duration"]), null);
});
