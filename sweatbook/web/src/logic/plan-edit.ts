// The form of a plan line: texts as typed, converted from and to what the API takes. Only the fields the exercise has
// are offered, and only those are sent.
import type { ExerciseRef, Field, PlanItem, TestKind } from "../types.ts";
import { parseKg } from "./numbers.ts";
import { parseRange, rangeInput } from "./range.ts";

const MAX_PCT = 500; // limit of the API (src/app.ts)

export type ItemForm = {
  exercise: ExerciseRef | null; // null = a note line
  label: string;
  sets: string;
  reps: string;
  toMax: boolean;
  distance: string;
  duration: string; // seconds
  loadKind: "none" | "kg" | "pct";
  loadKg: string;
  loadPct: string;
  loadRef: ExerciseRef | null;
  testKind: TestKind | "";
  rest: string;
  note: string;
};

export const emptyForm = (exercise: ExerciseRef | null): ItemForm => ({
  exercise,
  label: "",
  sets: "",
  reps: "",
  toMax: false,
  distance: "",
  duration: "",
  loadKind: "none",
  loadKg: "",
  loadPct: "",
  loadRef: null,
  testKind: "",
  rest: "",
  note: "",
});

export const formFromItem = (item: PlanItem): ItemForm => ({
  exercise: item.exercise,
  label: item.label ?? "",
  sets: rangeInput(item.sets),
  reps: rangeInput(item.reps),
  toMax: item.to_max,
  distance: rangeInput(item.distance_m),
  duration: rangeInput(item.duration_s),
  loadKind: item.load_pct !== null ? "pct" : item.load_kg !== null ? "kg" : "none",
  loadKg: item.load_kg === null ? "" : String(item.load_kg).replace(".", ","),
  loadPct: item.load_pct === null ? "" : String(item.load_pct).replace(".", ","),
  loadRef: item.load_ref,
  testKind: item.test_kind ?? "",
  rest: item.rest ?? "",
  note: item.note ?? "",
});

// Which inputs the form shows for an exercise.
export const hasField = (form: ItemForm, field: Field): boolean => form.exercise?.fields.includes(field) ?? false;

export type ItemBody = {
  exercise_id: string | null;
  label: string | null;
  sets: [number, number] | null;
  reps: [number, number] | null;
  distance_m: [number, number] | null;
  duration_s: [number, number] | null;
  to_max: boolean;
  load_kg: number | null;
  load_pct: number | null;
  load_ref_exercise_id: string | null;
  test_kind: TestKind | null;
  rest: string | null;
  note: string | null;
};

const orNull = (text: string): string | null => text.trim() || null;

// The body for POST/PATCH, or the name of the first invalid field. Everything is sent (null clears), so a PATCH
// always replaces the whole line.
export function itemBody(form: ItemForm): ItemBody | { invalid: string } {
  if (form.exercise === null) {
    return form.note.trim() ? { ...nothing(), note: form.note.trim() } : { invalid: "note" };
  }
  const sets = parseRange(form.sets);
  const reps = hasField(form, "reps") && !form.toMax ? parseRange(form.reps) : null;
  const distance = hasField(form, "distance") ? parseRange(form.distance) : null;
  const duration = hasField(form, "duration") ? parseRange(form.duration) : null;
  if (sets === undefined) return { invalid: "sets" };
  if (reps === undefined) return { invalid: "reps" };
  if (distance === undefined) return { invalid: "distance" };
  if (duration === undefined) return { invalid: "duration" };

  let loadKg: number | null = null;
  let loadPct: number | null = null;
  let loadRef: string | null = null;
  if (hasField(form, "weight") && form.loadKind === "kg") {
    const kg = parseKg(form.loadKg);
    if (kg === undefined) return { invalid: "load" };
    loadKg = kg;
  } else if (hasField(form, "weight") && form.loadKind === "pct") {
    const pct = parseKg(form.loadPct);
    if (pct === undefined || pct === null || pct <= 0 || pct > MAX_PCT || form.loadRef === null) return { invalid: "load" };
    loadPct = pct;
    loadRef = form.loadRef.id;
  }
  return {
    exercise_id: form.exercise.id,
    label: orNull(form.label),
    sets,
    reps,
    distance_m: distance,
    duration_s: duration,
    to_max: hasField(form, "reps") && form.toMax,
    load_kg: loadKg,
    load_pct: loadPct,
    load_ref_exercise_id: loadRef,
    test_kind: form.testKind === "one_rm" && !hasField(form, "weight") ? null : form.testKind || null,
    rest: orNull(form.rest),
    note: orNull(form.note),
  };
}

const nothing = (): ItemBody => ({
  exercise_id: null,
  label: null,
  sets: null,
  reps: null,
  distance_m: null,
  duration_s: null,
  to_max: false,
  load_kg: null,
  load_pct: null,
  load_ref_exercise_id: null,
  test_kind: null,
  rest: null,
  note: null,
});

// The ids with one moved a step up (-1) or down (+1); unchanged at the ends.
export function moved(ids: string[], id: string, step: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

// What the editor works on; it lives in a sheet's history state, so it holds only ids.
export type PlanTarget =
  | { kind: "program" }
  | { kind: "week"; id: string }
  | { kind: "session"; id: string }
  | { kind: "item"; id: string }
  | { kind: "new-item"; sessionId: string; note: boolean }; // note: a line without exercise
