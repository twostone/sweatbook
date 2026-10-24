import type { Metrics, SetInput, SetValues } from "../types.ts";
import { formatKg } from "./format.ts";
import { formatDuration, parseDuration, parseKg, parseReps } from "./numbers.ts";

// A set row as typed: text, so half-typed values and drafts survive as they are.
export type RowText = { kg: string; reps: string; time: string };
export type RowField = keyof RowText;

export const rowFromValues = (v: SetValues): RowText => ({
  kg: v.weight_kg === null ? "" : formatKg(v.weight_kg),
  reps: v.reps === null ? "" : String(v.reps),
  time: v.duration_s === null ? "" : formatDuration(v.duration_s),
});

// Which fields a row of this kind shows. Mirrors checkSet in src/data/sets.ts (kg is always optional: bodyweight).
export const FIELDS: Record<Metrics, RowField[]> = {
  weight_reps: ["kg", "reps"],
  duration: ["time"],
  weight_duration: ["kg", "time"],
};

// Only the fields of the kind are read; the first missing or wrong one is named, so the row can mark it.
export function valuesFromRow(row: RowText, metrics: Metrics): { ok: true; values: SetValues } | { ok: false; field: RowField } {
  const fields = FIELDS[metrics];
  const kg = fields.includes("kg") ? parseKg(row.kg) : null;
  if (kg === undefined) return { ok: false, field: "kg" };
  const reps = fields.includes("reps") ? parseReps(row.reps) : null;
  if (reps === undefined || (fields.includes("reps") && reps === null)) return { ok: false, field: "reps" };
  const time = fields.includes("time") ? parseDuration(row.time) : null;
  if (time === undefined || (fields.includes("time") && time === null)) return { ok: false, field: "time" };
  return { ok: true, values: { weight_kg: kg, reps, duration_s: time } };
}

// The "next set" row as typed, plus MAX and note.
export type DraftRow = RowText & { is_max: boolean; note: string };

// A draft row as the set the API takes; an empty note is no note.
export function draftInput(draft: DraftRow, metrics: Metrics): { ok: true; set: SetInput } | { ok: false; field: RowField } {
  const parsed = valuesFromRow(draft, metrics);
  if (!parsed.ok) return parsed;
  return { ok: true, set: { ...parsed.values, is_max: draft.is_max, note: draft.note.trim() || null } };
}
