import assert from "node:assert/strict";
import { test } from "node:test";
import { cardLine, currentWeek, findPlanned, formatPlanLine, clusterProgress, formatRange, groupWeeksByPhase, setProgress, weekDates } from "../web/src/logic/plan.ts";
import type { PlanItem, PlanWeek, SessionExercise } from "../web/src/types.ts";

const item = (over: Partial<PlanItem>): PlanItem => ({
  id: "i",
  position: 0,
  exercise: { id: "e", name: "Bankziehen", fields: ["weight", "reps"] },
  label: null,
  sets: null,
  reps: null,
  distance_m: null,
  duration_s: null,
  to_max: false,
  load_kg: null,
  load_pct: null,
  load_ref: null,
  weight_kg: null,
  test_kind: null,
  rest: null,
  note: null,
  ...over,
});

test("formatRange: a fixed number or min–max", () => {
  assert.equal(formatRange([5, 5]), "5");
  assert.equal(formatRange([3, 5]), "3–5");
});

test("formatPlanLine: sets × target @ load", () => {
  assert.equal(formatPlanLine(item({ sets: [4, 4], reps: [3, 5], load_pct: 85, weight_kg: 97.5 })), "4 × 3–5 @ 85 % = 97,5 kg");
  assert.equal(formatPlanLine(item({ sets: [5, 5], to_max: true, load_kg: 45, weight_kg: 45 })), "5 × max @ 45 kg");
  assert.equal(formatPlanLine(item({ sets: [5, 6], duration_s: [20, 30] })), "5–6 × 20–30 s");
  assert.equal(formatPlanLine(item({ sets: [3, 3], distance_m: [60, 60] })), "3 × 60 m");
  assert.equal(formatPlanLine(item({ sets: [1, 1], duration_s: [90, 90] })), "1 × 1:30");
  assert.equal(formatPlanLine(item({ reps: [10, 10], load_pct: 80 })), "10 @ 80 %"); // no 1RM known yet
  assert.equal(formatPlanLine(item({ sets: [2, 2] })), "2 Sätze");
});

test("setProgress: the next set of the plan, optional ones marked", () => {
  const p = item({ sets: [5, 6] });
  assert.equal(setProgress(p, 0), "Satz 1 von 6");
  assert.equal(setProgress(p, 5), "Satz 6 von 6 (optional)");
  assert.equal(setProgress(p, 6), "Geplante Sätze erledigt");
  assert.equal(setProgress(item({}), 0), "Satz 1 von 1");
});

test("cardLine: the plan before the first set, then done against planned", () => {
  const be = (over: Partial<SessionExercise>): SessionExercise => ({
    id: "be",
    position: 0,
    exercise: { id: "e", name: "Bankziehen", fields: ["weight", "reps"], archived: false },
    note: null,
    sets: [],
    last_time: null,
    planned: null,
    ...over,
  });
  const planned = { ...item({ sets: [4, 4], reps: [5, 5], weight_kg: 100 }), test: null };
  assert.equal(cardLine(be({ planned })), "4 × 5 @ 100 kg");
  assert.equal(cardLine(be({})), "Noch keine Sätze");
  const set = { id: "s", position: 1, weight_kg: 100, reps: 5, duration_s: null, distance_m: null, is_max: false, note: null, logged_at: "x" };
  assert.equal(cardLine(be({ planned, sets: [set, set] })), "2 × 5 @ 100 kg · 2 von 4");
});

test("currentWeek: the week of the next open session, else the last", () => {
  const w = (number: number, ...states: ("done" | "open")[]): PlanWeek => ({
    id: `w${number}`,
    number,
    phase_id: null,
    phase: null,
    deload: false,
    sessions: states.map((state, i) => ({ id: `s${number}${i}`, position: i, label: "A", state, skip_note: null, session_id: null, items: [] })),
  });
  assert.equal(currentWeek([w(1, "done"), w(2, "done", "open"), w(3, "open")])?.number, 2);
  assert.equal(currentWeek([w(1, "done"), w(2, "done")])?.number, 2);
  assert.equal(currentWeek([]), null);
});

test("groupWeeksByPhase: neighbouring weeks of one phase form a cluster", () => {
  const phases = [{ id: "a", name: "Aufbau", note: null }, { id: "p", name: "Peak", note: "kurz" }];
  const w = (number: number, phase_id: string | null): PlanWeek => ({ id: `w${number}`, number, phase_id, phase: null, deload: false, sessions: [] });
  const shape = (weeks: PlanWeek[]) => groupWeeksByPhase(weeks, phases).map((c) => [c.phase?.name ?? null, c.weeks.map((x) => x.number)]);
  assert.deepEqual(shape([w(1, "a"), w(2, "a"), w(3, "p")]), [["Aufbau", [1, 2]], ["Peak", [3]]]);
  assert.deepEqual(shape([w(1, "a"), w(2, "p"), w(3, "a")]), [["Aufbau", [1]], ["Peak", [2]], ["Aufbau", [3]]]);
  assert.deepEqual(shape([w(1, null), w(2, null), w(3, "p")]), [[null, [1, 2]], ["Peak", [3]]]);
  assert.deepEqual(shape([]), []);
});

test("clusterProgress: weeks and the sessions done or skipped", () => {
  const s = (state: "done" | "skipped" | "open") => ({ id: state, position: 0, label: "A", state, skip_note: null, session_id: null, items: [] });
  const w = (...states: ("done" | "skipped" | "open")[]): PlanWeek => ({ id: "w", number: 1, phase_id: null, phase: null, deload: false, sessions: states.map(s) });
  assert.equal(clusterProgress([w("done", "skipped"), w("open", "open")]), "2 Wochen · 2 von 4 Einheiten");
  assert.equal(clusterProgress([w()]), "1 Woche · 0 von 0 Einheiten");
});

test("weekDates: Monday to Sunday counted from the start date", () => {
  assert.equal(weekDates("2026-08-31", 1), "31.8.–6.9.");
  assert.equal(weekDates("2026-08-31", 8), "19.10.–25.10.");
});

test("findPlanned: the planned session and its week", () => {
  const session = { id: "s1", position: 0, label: "B", state: "open" as const, skip_note: null, session_id: null, items: [] };
  const weeks: PlanWeek[] = [{ id: "w", number: 8, phase_id: null, phase: null, deload: false, sessions: [session] }];
  assert.equal(findPlanned(weeks, "s1")?.week.number, 8);
  assert.equal(findPlanned(weeks, "nope"), null);
});
