import { draftFor } from "./logic/prefill.ts";
import { restoreRow, rowFields, rowFromValues, type DraftRow, type RowField } from "./logic/set-row.ts";
import { load, remove, save } from "./storage";
import type { Field, SessionExercise } from "./types";

// The "next set" row of an exercise. Kept in localStorage once touched, so a dead spot or a reload never costs an
// entry; untouched rows are computed fresh from the sets (prefill rule in logic/prefill).
export { draftInput, type DraftRow } from "./logic/set-row.ts";

const key = (be: SessionExercise) => `row:draft:${be.id}`;

export const freshDraft = (be: SessionExercise): DraftRow => ({ ...rowFromValues(draftFor(be)), is_max: false, note: "" });
export const initialDraft = (be: SessionExercise): DraftRow => restoreRow(load<Partial<DraftRow>>(key(be)), freshDraft(be));
export const keepDraft = (be: SessionExercise, draft: DraftRow) => save(key(be), draft);
export const dropDraft = (be: SessionExercise) => remove(key(be));

// Column headings of a set row.
const HEADINGS: Record<RowField, string> = { kg: "kg", reps: "Wdh.", dist: "m", time: "Zeit" };
export const headings = (fields: readonly Field[]) => rowFields(fields).map((f) => HEADINGS[f]);

const FIELD_NAMES: Record<RowField, string> = { kg: "Gewicht", reps: "Wiederholungen", dist: "Strecke", time: "Zeit" };
export const fieldName = (field: RowField) => FIELD_NAMES[field];
