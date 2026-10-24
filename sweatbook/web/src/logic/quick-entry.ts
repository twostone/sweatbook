import type { Metrics, SetValues } from "../types.ts";
import { parseDuration, parseKg } from "./numbers.ts";

// The API takes at most this many sets per request.
export const MAX_QUICK_SETS = 20;

// "[count ×] value [@ kg]": value is reps for weight_reps, else a time typed like the time field ("45", "1:05", "105").
// × may be typed as x, X or *; "kg" after the weight is allowed. Anything else -> null, nothing is guessed.
const PATTERN = /^(?:(\d+)\s*[x×*]\s*)?([\d:]+)\s*(?:@\s*([\d.,]+)\s*(?:kg)?)?$/i;

export function parseQuickEntry(text: string, metrics: Metrics): SetValues[] | null {
  const match = PATTERN.exec(text.trim());
  if (!match) return null;
  const [, countText, valueText = "", kgText] = match;
  const count = countText === undefined ? 1 : Number(countText);
  if (count < 1 || count > MAX_QUICK_SETS) return null;

  const weight = kgText === undefined ? null : parseKg(kgText);
  if (weight === undefined) return null;
  if (metrics === "duration" && weight !== null) return null;

  let set: SetValues;
  if (metrics === "weight_reps") {
    if (!/^\d+$/.test(valueText)) return null;
    const reps = Number(valueText);
    if (reps < 1) return null;
    set = { weight_kg: weight, reps, duration_s: null };
  } else {
    const seconds = parseDuration(valueText);
    if (!seconds) return null;
    set = { weight_kg: weight, reps: null, duration_s: seconds };
  }
  return Array.from({ length: count }, () => ({ ...set }));
}
