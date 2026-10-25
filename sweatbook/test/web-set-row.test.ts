import assert from "node:assert/strict";
import { test } from "node:test";
import { draftInput, restoreRow, rowFields, rowFromValues, valuesFromRow } from "../web/src/logic/set-row.ts";
import type { Field } from "../web/src/types.ts";

const WR: Field[] = ["weight", "reps"];
const D: Field[] = ["duration"];
const WD: Field[] = ["weight", "duration"];
const FARMER: Field[] = ["weight", "distance", "duration"];
const row = (kg: string, reps: string, time: string, dist = "") => ({ kg, reps, time, dist });
const values = (weight_kg: number | null, reps: number | null, duration_s: number | null, distance_m: number | null = null) => ({
  weight_kg,
  reps,
  duration_s,
  distance_m,
});

test("a row shows numbers as text, empty kg stays empty (bodyweight)", () => {
  assert.deepEqual(rowFromValues(values(102.5, 5, null)), row("102,5", "5", ""));
  assert.deepEqual(rowFromValues(values(null, null, 72, 60)), row("", "", "1:12", "60"));
});

test("a row shows the exercise's fields in their order", () => {
  assert.deepEqual(rowFields(WR), ["kg", "reps"]);
  assert.deepEqual(rowFields(FARMER), ["kg", "dist", "time"]);
});

test("a row becomes the fields of its exercise, the others stay empty", () => {
  assert.deepEqual(valuesFromRow(row("100", "5", ""), WR), { ok: true, values: values(100, 5, null) });
  assert.deepEqual(valuesFromRow(row("", "10", ""), WR), { ok: true, values: values(null, 10, null) });
  assert.deepEqual(valuesFromRow(row("50", "", "112"), D), { ok: true, values: values(null, null, 72) });
  assert.deepEqual(valuesFromRow(row("10", "", "30"), WD), { ok: true, values: values(10, null, 30) });
  assert.deepEqual(valuesFromRow(row("24", "", "45", "60"), FARMER), { ok: true, values: values(24, null, 45, 60) });
  assert.deepEqual(valuesFromRow(row("24", "", "", "60 m"), FARMER), { ok: true, values: values(24, null, null, 60) }, "one value field is enough");
});

test("a row names the field that is missing or wrong", () => {
  assert.deepEqual(valuesFromRow(row("100", "", ""), WR), { ok: false, field: "reps" });
  assert.deepEqual(valuesFromRow(row("abc", "5", ""), WR), { ok: false, field: "kg" });
  assert.deepEqual(valuesFromRow(row("", "", "190"), D), { ok: false, field: "time" });
  assert.deepEqual(valuesFromRow(row("24", "", "", ""), FARMER), { ok: false, field: "dist" }, "the first value field when all are empty");
  assert.deepEqual(valuesFromRow(row("24", "", "45", "6,5"), FARMER), { ok: false, field: "dist" }, "whole metres");
});

test("a draft row becomes a set with MAX and note, an empty note is none", () => {
  assert.deepEqual(draftInput({ ...row("100", "5", ""), is_max: true, note: "  " }, WR), {
    ok: true,
    set: { ...values(100, 5, null), is_max: true, note: null },
  });
  assert.deepEqual(draftInput({ ...row("", "", ""), is_max: false, note: "x" }, WR), { ok: false, field: "reps" });
});

test("a row stored before a field existed gets that field from the fresh row", () => {
  const stored = { kg: "100", reps: "5", time: "" };
  assert.deepEqual(restoreRow(stored, row("", "", "", "")), row("100", "5", "", ""));
  assert.deepEqual(restoreRow(null, row("80", "8", "")), row("80", "8", ""));
});
