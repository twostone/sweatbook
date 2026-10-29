// A range typed into a plan field: "5", "5-8" or "5–8" (min, max). Same convention as numbers.ts: a range, null for an
// empty field, undefined when the text is not valid.
import type { Range } from "../types.ts";

const MAX_TARGET = 100_000; // limit of the API (src/app.ts)

export function parseRange(text: string): Range | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const match = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(t);
  if (!match) return undefined;
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : Number(match[2]);
  return min <= max && max <= MAX_TARGET ? [min, max] : undefined;
}

// What the field shows for a stored range ("5", "5–8"); empty for none.
export const rangeInput = (range: Range | null): string => (range === null ? "" : range[0] === range[1] ? String(range[0]) : `${range[0]}–${range[1]}`);
