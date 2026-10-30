import { test } from "node:test";
import assert from "node:assert/strict";
import { planText, summarizeSets } from "../src/mcp-views.ts";
import type { PlanItem } from "../src/data/plan.ts";

const set = (weight_kg: number | null, reps: number | null, extra: object = {}) => ({ weight_kg, reps, distance_m: null, duration_s: null, is_max: false, ...extra });

test("summarizeSets: equal neighbours are counted, bodyweight has no weight, time and distance carry units", () => {
  assert.equal(summarizeSets([]), "no sets");
  assert.equal(summarizeSets([set(100, 5), set(100, 5), set(100, 5), set(100, 4)]), "3×5 @ 100 kg, 1×4 @ 100 kg");
  assert.equal(summarizeSets([set(100, 5), set(90, 5), set(100, 5)]), "1×5 @ 100 kg, 1×5 @ 90 kg, 1×5 @ 100 kg");
  assert.equal(summarizeSets([set(null, 12), set(null, 10, { is_max: true })]), "1×12, 1×10 (max)");
  assert.equal(summarizeSets([set(null, null, { duration_s: 60 }), set(null, null, { duration_s: 60 })]), "2×60 s");
  assert.equal(summarizeSets([set(null, null, { distance_m: 400 })]), "1×400 m");
});

const item = (over: Partial<PlanItem>): PlanItem => ({
  id: "i", position: 0, exercise: { id: "e", name: "Kniebeuge", fields: ["weight", "reps"] }, label: null, sets: null, reps: null, distance_m: null,
  duration_s: null, to_max: false, load_kg: null, load_pct: null, load_ref: null, weight_kg: null, test_kind: null, rest: null, note: null, ...over,
});

test("planText: sets, reps, load and what the plan leaves out", () => {
  assert.equal(planText(item({ sets: [3, 3], reps: [5, 8], load_kg: 80, weight_kg: 80 })), "3×5–8 @ 80 kg");
  const ref = { id: "r", name: "Kniebeuge", fields: ["weight", "reps"] as ("weight" | "reps")[] };
  assert.equal(planText(item({ sets: [5, 5], reps: [5, 5], load_pct: 70, load_ref: ref, weight_kg: 97.5, rest: "2 min" })), "5×5 @ 97.5 kg (70 % of Kniebeuge); rest 2 min");
  assert.equal(planText(item({ reps: [5, 5], load_pct: 70, load_ref: ref })), "5 @ 70 % of Kniebeuge (no 1RM yet)");
  assert.equal(planText(item({ to_max: true, sets: [1, 1], test_kind: "best" })), "1×max; best-performance test");
  assert.equal(planText(item({ duration_s: [30, 60] })), "30–60 s");
  assert.equal(planText(item({ exercise: null, note: "Aufwärmen" })), "Aufwärmen");
});
