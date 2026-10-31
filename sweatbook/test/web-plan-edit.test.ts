import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyForm, formFromItem, itemBody, moved } from "../web/src/logic/plan-edit.ts";
import type { ExerciseRef, PlanItem } from "../web/src/types.ts";

const squat: ExerciseRef = { id: "sq", name: "Kniebeuge", fields: ["weight", "reps"] };
const plank: ExerciseRef = { id: "pl", name: "Plank", fields: ["duration"] };

test("a note line needs a note and has no targets", () => {
  assert.deepEqual(itemBody(emptyForm(null)), { invalid: "note" });
  const body = itemBody({ ...emptyForm(null), note: " Aufwärmen " });
  assert.ok(!("invalid" in body));
  assert.equal(body.exercise_id, null);
  assert.equal(body.note, "Aufwärmen");
  assert.equal(body.sets, null);
});

test("a percent load needs a reference exercise and a value in range", () => {
  const form = { ...emptyForm(squat), sets: "4", reps: "3-5", loadKind: "pct" as const, loadPct: "85" };
  assert.deepEqual(itemBody(form), { invalid: "load" });
  const body = itemBody({ ...form, loadRef: squat });
  assert.ok(!("invalid" in body));
  assert.deepEqual([body.sets, body.reps, body.load_pct, body.load_ref_exercise_id, body.load_kg], [[4, 4], [3, 5], 85, "sq", null]);
  assert.deepEqual(itemBody({ ...form, loadRef: squat, loadPct: "0" }), { invalid: "load" });
  assert.deepEqual(itemBody({ ...form, loadRef: squat, loadPct: "501" }), { invalid: "load" });
});

test("a fixed load sends kg only, comma allowed", () => {
  const body = itemBody({ ...emptyForm(squat), reps: "5", loadKind: "kg", loadKg: "72,5" });
  assert.ok(!("invalid" in body));
  assert.deepEqual([body.load_kg, body.load_pct, body.load_ref_exercise_id], [72.5, null, null]);
});

test("only the fields of the exercise are sent", () => {
  const body = itemBody({ ...emptyForm(plank), sets: "3", duration: "30-45", reps: "9", loadKind: "kg", loadKg: "10", toMax: true, testKind: "one_rm" });
  assert.ok(!("invalid" in body));
  assert.deepEqual([body.reps, body.duration_s, body.load_kg, body.to_max, body.test_kind], [null, [30, 45], null, false, null]);
});

test("max replaces the reps", () => {
  const body = itemBody({ ...emptyForm(squat), reps: "5", toMax: true });
  assert.ok(!("invalid" in body));
  assert.deepEqual([body.reps, body.to_max], [null, true]);
});

test("a typo names the field", () => {
  assert.deepEqual(itemBody({ ...emptyForm(squat), sets: "x" }), { invalid: "sets" });
  assert.deepEqual(itemBody({ ...emptyForm(squat), reps: "8-5" }), { invalid: "reps" });
});

test("formFromItem turns a stored line back into the form", () => {
  const item: PlanItem = {
    id: "i", position: 0, exercise: squat, label: "Pause", sets: [4, 4], reps: [3, 5], distance_m: null, duration_s: null,
    to_max: false, load_kg: null, load_kg_female: null, load_pct: 82.5, load_ref: squat, weight_kg: 100, test_kind: "one_rm", rest: "3 min", note: null,
  };
  const form = formFromItem(item);
  assert.deepEqual([form.sets, form.reps, form.loadKind, form.loadPct, form.testKind, form.note], ["4", "3–5", "pct", "82,5", "one_rm", ""]);
});

test("moved swaps with the neighbour and stops at the ends", () => {
  assert.deepEqual(moved(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moved(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moved(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moved(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
});

test("the women's weight is sent with a fixed load only, empty stays null", () => {
  const withBoth = itemBody({ ...emptyForm(squat), reps: "5", loadKind: "kg", loadKg: "24", loadKgFemale: "16,5" });
  assert.ok(!("invalid" in withBoth));
  assert.deepEqual([withBoth.load_kg, withBoth.load_kg_female], [24, 16.5]);
  const without = itemBody({ ...emptyForm(squat), reps: "5", loadKind: "kg", loadKg: "24" });
  assert.ok(!("invalid" in without));
  assert.equal(without.load_kg_female, null);
  const pct = itemBody({ ...emptyForm(squat), reps: "5", loadKind: "pct", loadPct: "80", loadRef: squat, loadKgFemale: "16" });
  assert.ok(!("invalid" in pct));
  assert.equal(pct.load_kg_female, null);
  assert.deepEqual(itemBody({ ...emptyForm(squat), reps: "5", loadKind: "kg", loadKg: "24", loadKgFemale: "x" }), { invalid: "load" });
});
