import { VALUE_FIELDS, type Field, type SetLog } from "../types.ts";
import { formatDuration } from "./numbers.ts";

const kgFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
export const formatKg = (kg: number) => kgFormat.format(kg);

// "KG" = bodyweight, the label the set rows use for an empty weight.
const weightLabel = (kg: number | null) => (kg === null ? "KG" : `${formatKg(kg)} kg`);
const maxSuffix = (sets: SetLog[]) => (sets.some((s) => s.is_max) ? " MAX" : "");

const valueFieldsOf = (fields: readonly Field[]) => fields.filter((f) => VALUE_FIELDS.includes(f));

// One value as shown: reps as a number, time as m:ss, distance in metres.
function valueText(field: Field, value: number): string {
  if (field === "duration") return formatDuration(value);
  if (field === "distance") return `${value} m`;
  return String(value);
}

function fieldValue(set: SetLog, field: Field): number | null {
  if (field === "reps") return set.reps;
  if (field === "duration") return set.duration_s;
  if (field === "distance") return set.distance_m;
  return set.weight_kg;
}

export function formatSet(set: SetLog, fields: readonly Field[]): string {
  return formatSetValue(set, fields) + maxSuffix([set]);
}

// A set with only reps reads "100 kg × 5" (KG = bodyweight), also when the exercise has more fields; everything else
// lists its values ("5 Wdh. · 0:45"), the weight after an @.
function formatSetValue(set: SetLog, fields: readonly Field[]): string {
  const filled = valueFieldsOf(fields).filter((f) => fieldValue(set, f) !== null);
  const hasWeight = fields.includes("weight");
  if (filled.length === 1 && filled[0] === "reps") {
    return hasWeight ? `${weightLabel(set.weight_kg)} × ${set.reps}` : `${set.reps} Wdh.`;
  }
  const parts = filled.map((f) => (f === "reps" ? `${set.reps} Wdh.` : valueText(f, fieldValue(set, f)!)));
  const weight = hasWeight && set.weight_kg !== null ? ` @ ${formatKg(set.weight_kg)} kg` : "";
  return parts.join(" · ") + weight;
}

const allSame = <T>(items: T[]) => items.every((x) => x === items[0]);

// Mixed sets are listed one by one up to this many; more would not fit a card line, so then only the best one shows.
const MAX_LISTED = 3;

// Short text for an overview card or "last time": as compact as the sets allow.
export function summarize(sets: SetLog[], fields: readonly Field[]): string {
  if (sets.length === 0) return "";
  const valueFields = valueFieldsOf(fields);
  const main = valueFields.length === 1 ? valueFields[0]! : null;
  const hasWeight = fields.includes("weight");
  const weights = sets.map((s) => s.weight_kg);
  const values = sets.map((s) => (main ? fieldValue(s, main) : null));
  const sameValue = main !== null && allSame(values);
  const sameWeight = allSame(weights);
  const shown = (v: number | null) => (main && v !== null ? valueText(main, v) : "");
  let text: string;
  if (sets.length === 1) text = formatSetValue(sets[0]!, fields);
  else if (sameValue && sameWeight) {
    text = `${sets.length} × ${shown(values[0]!)}${hasWeight && weights[0] !== null ? ` @ ${formatKg(weights[0]!)} kg` : ""}`;
  } else if (sameValue && hasWeight && weights.every((w) => w !== null)) {
    text = `${sets.length} × ${shown(values[0]!)} · bis ${formatKg(Math.max(...(weights as number[])))} kg`;
  } else if (sameWeight && main === "reps" && hasWeight) {
    text = `${weightLabel(weights[0]!)} × ${values.join(", ")}`;
  } else if (sets.length <= MAX_LISTED) {
    text = sets.map((s) => formatSetValue(s, fields)).join(", ");
  } else {
    text = `${sets.length} Sätze · bis ${best(sets, fields)}`;
  }
  return text + maxSuffix(sets);
}

// The top of mixed sets: the heaviest weight, else the largest value of the first value field.
function best(sets: SetLog[], fields: readonly Field[]): string {
  const weights = sets.map((s) => s.weight_kg).filter((w) => w !== null);
  if (fields.includes("weight") && weights.length) return `${formatKg(Math.max(...weights))} kg`;
  const field = valueFieldsOf(fields)[0] ?? "reps";
  return valueText(field, Math.max(...sets.map((s) => fieldValue(s, field) ?? 0)));
}

// "Sa 24. Okt · 13:40". The time zone is the device's; tests pass one.
export function formatSessionDate(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("de-DE", { ...o, timeZone }).format(d);
  const weekday = part({ weekday: "short" }).replace(".", "");
  const month = part({ month: "short" }).replace(".", "");
  return `${weekday} ${part({ day: "numeric" })}. ${month} · ${part({ hour: "2-digit", minute: "2-digit" })}`;
}

// "17. Okt" for "last time" and lists.
export function formatShortDate(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  const month = new Intl.DateTimeFormat("de-DE", { month: "short", timeZone }).format(d).replace(".", "");
  return `${new Intl.DateTimeFormat("de-DE", { day: "numeric", timeZone }).format(d)}. ${month}`;
}

// How a block is named on buttons: its exercise, or a superset's exercises joined ("Bankdrücken + Klimmzüge").
export const blockLabel = (block: { exercises: { exercise: { name: string } }[] }) =>
  block.exercises.map((e) => e.exercise.name).join(" + ");
