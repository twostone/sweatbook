import { draftFor } from "./logic/prefill.ts";
import { FIELDS, rowFromValues, valuesFromRow, type RowField, type RowText } from "./logic/set-row.ts";
import { clearRow, loadRow, saveRow } from "./store.svelte";
import type { Metrics, SessionExercise, SetInput } from "./types";

// The "next set" row of an exercise: typed text plus MAX and note. Kept in localStorage once touched, so a dead spot
// or a reload never costs an entry; untouched rows are computed fresh from the sets (prefill rule in logic/prefill).
export type DraftRow = RowText & { is_max: boolean; note: string };

const key = (be: SessionExercise) => `draft:${be.id}`;

export const freshDraft = (be: SessionExercise): DraftRow => ({ ...rowFromValues(draftFor(be)), is_max: false, note: "" });
export const initialDraft = (be: SessionExercise): DraftRow => loadRow<DraftRow>(key(be)) ?? freshDraft(be);
export const keepDraft = (be: SessionExercise, draft: DraftRow) => saveRow(key(be), draft);
export const dropDraft = (be: SessionExercise) => clearRow(key(be));

export function draftInput(draft: DraftRow, metrics: Metrics): { ok: true; set: SetInput } | { ok: false; field: RowField } {
  const parsed = valuesFromRow(draft, metrics);
  if (!parsed.ok) return parsed;
  return { ok: true, set: { ...parsed.values, is_max: draft.is_max, note: draft.note.trim() || null } };
}

// Column headings of a set row.
const HEADINGS: Record<RowField, string> = { kg: "kg", reps: "Wdh.", time: "Zeit" };
export const headings = (metrics: Metrics) => FIELDS[metrics].map((f) => HEADINGS[f]);

const FIELD_NAMES: Record<RowField, string> = { kg: "Gewicht", reps: "Wiederholungen", time: "Zeit" };
export const fieldName = (field: RowField) => FIELD_NAMES[field];
