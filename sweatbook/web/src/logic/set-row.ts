import { VALUE_FIELDS, type Field, type SetInput, type SetValues } from "../types.ts";
import { formatKg } from "./format.ts";
import { formatDuration, parseDistance, parseDuration, parseKg, parseReps } from "./numbers.ts";

// A set row as typed: text, so half-typed values and drafts survive as they are.
export type RowText = { kg: string; reps: string; dist: string; time: string };
export type RowField = keyof RowText;

export const rowFromValues = (v: SetValues): RowText => ({
  kg: v.weight_kg === null ? "" : formatKg(v.weight_kg),
  reps: v.reps === null ? "" : String(v.reps),
  dist: v.distance_m === null ? "" : String(v.distance_m),
  time: v.duration_s === null ? "" : formatDuration(v.duration_s),
});

// The row field for each exercise field, and how its text is read (number, null = empty, undefined = invalid).
const ROW_FIELD: Record<Field, RowField> = { weight: "kg", reps: "reps", distance: "dist", duration: "time" };
const PARSE: Record<Field, (text: string) => number | null | undefined> = {
  weight: parseKg,
  reps: parseReps,
  distance: parseDistance,
  duration: parseDuration,
};

// The fields a row of this exercise shows, in the exercise's order.
export const rowFields = (fields: readonly Field[]): RowField[] => fields.map((f) => ROW_FIELD[f]);

// Mirrors checkSet in src/data/sets.ts: only the exercise's fields are read, kg may stay empty (bodyweight), at least
// one other field is needed. The first wrong field is named, or the first value field when all are empty, so the row
// can mark it.
export function valuesFromRow(row: RowText, fields: readonly Field[]): { ok: true; values: SetValues } | { ok: false; field: RowField } {
  const parsed: Record<Field, number | null> = { weight: null, reps: null, distance: null, duration: null };
  for (const field of fields) {
    const value = PARSE[field](row[ROW_FIELD[field]]);
    if (value === undefined) return { ok: false, field: ROW_FIELD[field] };
    parsed[field] = value;
  }
  const valueFields = fields.filter((f) => VALUE_FIELDS.includes(f));
  if (!valueFields.some((f) => parsed[f] !== null)) return { ok: false, field: ROW_FIELD[valueFields[0] ?? "reps"] };
  return { ok: true, values: { weight_kg: parsed.weight, reps: parsed.reps, duration_s: parsed.duration, distance_m: parsed.distance } };
}

// The "next set" row as typed, plus MAX and note.
export type DraftRow = RowText & { is_max: boolean; note: string };

// A draft row as the set the API takes; an empty note is no note.
export function draftInput(draft: DraftRow, fields: readonly Field[]): { ok: true; set: SetInput } | { ok: false; field: RowField } {
  const parsed = valuesFromRow(draft, fields);
  if (!parsed.ok) return parsed;
  return { ok: true, set: { ...parsed.values, is_max: draft.is_max, note: draft.note.trim() || null } };
}
