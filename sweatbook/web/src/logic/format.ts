import type { Metrics, SetLog } from "../types.ts";
import { formatDuration } from "./numbers.ts";

const kgFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
export const formatKg = (kg: number) => kgFormat.format(kg);

// "KG" = bodyweight, the label the set rows use for an empty weight.
const weightLabel = (kg: number | null) => (kg === null ? "KG" : `${formatKg(kg)} kg`);
const maxSuffix = (sets: SetLog[]) => (sets.some((s) => s.is_max) ? " MAX" : "");

export function formatSet(set: SetLog, metrics: Metrics): string {
  return formatSetValue(set, metrics) + maxSuffix([set]);
}

function formatSetValue(set: SetLog, metrics: Metrics): string {
  if (metrics === "weight_reps") return `${weightLabel(set.weight_kg)} × ${set.reps}`;
  const time = formatDuration(set.duration_s ?? 0);
  return metrics === "weight_duration" && set.weight_kg !== null ? `${time} @ ${formatKg(set.weight_kg)} kg` : time;
}

const allSame = <T>(items: T[]) => items.every((x) => x === items[0]);

// Mixed sets are listed one by one up to this many; more would not fit a card line, so then only the best one shows.
const MAX_LISTED = 3;

// Short text for an overview card or "last time": as compact as the sets allow.
export function summarize(sets: SetLog[], metrics: Metrics): string {
  if (sets.length === 0) return "";
  const weights = sets.map((s) => s.weight_kg);
  const values = sets.map((s) => (metrics === "weight_reps" ? s.reps : s.duration_s));
  const valueText = (v: number | null) => (metrics === "weight_reps" ? String(v) : formatDuration(v ?? 0));
  const sameValue = allSame(values);
  const sameWeight = allSame(weights);
  let text: string;
  if (sets.length === 1) text = formatSetValue(sets[0]!, metrics);
  else if (sameValue && sameWeight) {
    text = `${sets.length} × ${valueText(values[0]!)}${weights[0] === null ? "" : ` @ ${formatKg(weights[0]!)} kg`}`;
  } else if (sameValue && weights.every((w) => w !== null)) {
    text = `${sets.length} × ${valueText(values[0]!)} · bis ${formatKg(Math.max(...(weights as number[])))} kg`;
  } else if (sameWeight && metrics === "weight_reps") {
    text = `${weightLabel(weights[0]!)} × ${values.join(", ")}`;
  } else if (sets.length <= MAX_LISTED) {
    text = sets.map((s) => formatSetValue(s, metrics)).join(", ");
  } else {
    text = `${sets.length} Sätze · bis ${best(sets, metrics)}`;
  }
  return text + maxSuffix(sets);
}

// The top of mixed sets: the heaviest weight, or for plain time exercises the longest time.
function best(sets: SetLog[], metrics: Metrics): string {
  const weights = sets.map((s) => s.weight_kg).filter((w) => w !== null);
  if (metrics !== "duration" && weights.length) return `${formatKg(Math.max(...weights))} kg`;
  return formatDuration(Math.max(...sets.map((s) => s.duration_s ?? 0)));
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
