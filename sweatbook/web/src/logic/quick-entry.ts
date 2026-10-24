import { VALUE_FIELDS, type Field, type SetValues } from "../types.ts";
import { parseDistance, parseDuration, parseKg } from "./numbers.ts";

// The API takes at most this many sets per request.
export const MAX_QUICK_SETS = 20;

// "[count ×] value [@ kg]": value is reps, a time typed like the time field ("45", "1:05", "105") or whole metres
// ("60", "60m"), whichever single value field the exercise has. × may be typed as x, X or *; "kg" after the weight is
// allowed. Anything else -> null, nothing is guessed.
const PATTERN = /^(?:(\d+)\s*[x×*]\s*)?([\d:]+)\s*(m)?\s*(?:@\s*([\d.,]+)\s*(?:kg)?)?$/i;

// The field the quick entry fills: only for exercises with exactly one value field (kg + reps, time, distance, …).
export function quickEntryField(fields: readonly Field[]): Field | null {
  const valueFields = fields.filter((f) => VALUE_FIELDS.includes(f));
  return valueFields.length === 1 ? valueFields[0]! : null;
}

function parseValue(field: Field, text: string, metreSign: boolean): number | null {
  if (metreSign && field !== "distance") return null;
  if (field === "reps") return /^\d+$/.test(text) && Number(text) >= 1 ? Number(text) : null;
  const value = field === "distance" ? parseDistance(text) : parseDuration(text);
  return value ? value : null;
}

export function parseQuickEntry(text: string, fields: readonly Field[]): SetValues[] | null {
  const field = quickEntryField(fields);
  const match = PATTERN.exec(text.trim());
  if (!field || !match) return null;
  const [, countText, valueText = "", metreSign, kgText] = match;
  const count = countText === undefined ? 1 : Number(countText);
  if (count < 1 || count > MAX_QUICK_SETS) return null;

  const weight = kgText === undefined ? null : parseKg(kgText);
  if (weight === undefined) return null;
  if (weight !== null && !fields.includes("weight")) return null;

  const value = parseValue(field, valueText, metreSign !== undefined);
  if (value === null) return null;
  const set: SetValues = {
    weight_kg: weight,
    reps: field === "reps" ? value : null,
    duration_s: field === "duration" ? value : null,
    distance_m: field === "distance" ? value : null,
  };
  return Array.from({ length: count }, () => ({ ...set }));
}

// What the quick entry field shows as an example, matching the exercise; null when it has no quick entry.
const EXAMPLE: Record<"reps" | "distance" | "duration", { value: string; kg: string }> = {
  reps: { value: "3×10", kg: "3×5@100" },
  duration: { value: "3×45", kg: "3×30@10" },
  distance: { value: "3×400m", kg: "3×60m@24" },
};
export function quickEntryExample(fields: readonly Field[]): string | null {
  const field = quickEntryField(fields);
  if (!field || field === "weight") return null;
  return fields.includes("weight") ? EXAMPLE[field].kg : EXAMPLE[field].value;
}
