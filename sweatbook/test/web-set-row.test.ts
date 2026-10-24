import assert from "node:assert/strict";
import { test } from "node:test";
import { draftInput, rowFromValues, valuesFromRow } from "../web/src/logic/set-row.ts";

test("a row shows numbers as text, empty kg stays empty (bodyweight)", () => {
  assert.deepEqual(rowFromValues({ weight_kg: 102.5, reps: 5, duration_s: null }), { kg: "102,5", reps: "5", time: "" });
  assert.deepEqual(rowFromValues({ weight_kg: null, reps: null, duration_s: 72 }), { kg: "", reps: "", time: "1:12" });
});

test("a row becomes the fields its metrics need", () => {
  assert.deepEqual(valuesFromRow({ kg: "100", reps: "5", time: "" }, "weight_reps"), { ok: true, values: { weight_kg: 100, reps: 5, duration_s: null } });
  assert.deepEqual(valuesFromRow({ kg: "", reps: "10", time: "" }, "weight_reps"), { ok: true, values: { weight_kg: null, reps: 10, duration_s: null } });
  assert.deepEqual(valuesFromRow({ kg: "50", reps: "", time: "112" }, "duration"), { ok: true, values: { weight_kg: null, reps: null, duration_s: 72 } });
  assert.deepEqual(valuesFromRow({ kg: "10", reps: "", time: "30" }, "weight_duration"), { ok: true, values: { weight_kg: 10, reps: null, duration_s: 30 } });
});

test("a row names the field that is missing or wrong", () => {
  assert.deepEqual(valuesFromRow({ kg: "100", reps: "", time: "" }, "weight_reps"), { ok: false, field: "reps" });
  assert.deepEqual(valuesFromRow({ kg: "abc", reps: "5", time: "" }, "weight_reps"), { ok: false, field: "kg" });
  assert.deepEqual(valuesFromRow({ kg: "", reps: "", time: "190" }, "duration"), { ok: false, field: "time" });
});

test("a draft row becomes a set with MAX and note, an empty note is none", () => {
  assert.deepEqual(draftInput({ kg: "100", reps: "5", time: "", is_max: true, note: "  " }, "weight_reps"), {
    ok: true,
    set: { weight_kg: 100, reps: 5, duration_s: null, is_max: true, note: null },
  });
  assert.deepEqual(draftInput({ kg: "", reps: "", time: "", is_max: false, note: "x" }, "weight_reps"), { ok: false, field: "reps" });
});
