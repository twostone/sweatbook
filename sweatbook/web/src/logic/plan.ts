import type { ExerciseTest, PlanItem, PlanWeek, PlannedSession, Range, SessionExercise, TestKind } from "../types.ts";
import { formatKg, summarize } from "./format.ts";
import { formatDuration } from "./numbers.ts";

// How a plan line reads. Ranges are [min, max]; a fixed number is [n, n].
export const formatRange = ([min, max]: Range): string => (min === max ? String(min) : `${min}–${max}`);

// Under a minute in seconds ("20–30 s"), else as m:ss.
function durationText([min, max]: Range): string {
  if (max < 60) return `${formatRange([min, max])} s`;
  return min === max ? formatDuration(min) : `${formatDuration(min)}–${formatDuration(max)}`;
}

// What is asked per set: "3–5", "max", "20–30 s", "60 m" (with several targets joined by "·").
function targetText(item: PlanItem): string {
  const parts: string[] = [];
  if (item.to_max) parts.push("max");
  else if (item.reps) parts.push(formatRange(item.reps));
  if (item.distance_m) parts.push(`${formatRange(item.distance_m)} m`);
  if (item.duration_s) parts.push(durationText(item.duration_s));
  return parts.join(" · ");
}

function loadText(item: PlanItem): string {
  if (item.load_pct !== null) {
    const pct = `${formatKg(item.load_pct)} %`;
    return item.weight_kg !== null ? `${pct} = ${formatKg(item.weight_kg)} kg` : pct;
  }
  return item.weight_kg !== null ? `${formatKg(item.weight_kg)} kg` : "";
}

// "4 × 3–5 @ 85 % = 97,5 kg", "5 × max @ 45 kg", "3 × 60 m". Rest and note are shown apart.
export function formatPlanLine(item: PlanItem): string {
  const target = targetText(item);
  const sets = item.sets ? formatRange(item.sets) : "";
  const left = sets && target ? `${sets} × ${target}` : sets ? `${sets} Sätze` : target;
  const load = loadText(item);
  return [left, load && `@ ${load}`].filter(Boolean).join(" ");
}

// Sets planned: the upper bound of a range (the last ones up to it are optional); a line without sets is one set.
export const plannedSetCount = (item: PlanItem): number => item.sets?.[1] ?? 1;
const requiredSetCount = (item: PlanItem): number => item.sets?.[0] ?? 1;

// Where the exercise stands against its plan: "Satz 3 von 4", "Satz 5 von 6 (optional)", or done.
export function setProgress(item: PlanItem, done: number): string {
  const count = plannedSetCount(item);
  if (done >= count) return "Geplante Sätze erledigt";
  return `Satz ${done + 1} von ${count}${done + 1 > requiredSetCount(item) ? " (optional)" : ""}`;
}

// The line on an overview card of a session: the plan until the first set, then what was done against the plan.
export function cardLine(be: SessionExercise): string {
  const planned = be.planned;
  if (be.sets.length === 0) {
    if (planned) return formatPlanLine(planned);
    return be.last_time ? `Letztes Mal ${summarize(be.last_time.sets, be.exercise.fields)}` : "Noch keine Sätze";
  }
  const done = summarize(be.sets, be.exercise.fields);
  return planned ? `${done} · ${be.sets.length} von ${plannedSetCount(planned)}` : done;
}

export const TEST_KIND_NAMES: Record<TestKind, string> = { one_rm: "1RM", best: "Bestleistung" };

const STATE_TEXT = { done: "erledigt", skipped: "übersprungen", open: "offen" } as const;
export function stateText(session: PlannedSession): string {
  return session.state === "skipped" && session.skip_note ? session.skip_note : STATE_TEXT[session.state];
}

// The week to show open: the one with the next open planned session, else the last.
export function currentWeek(weeks: PlanWeek[]): PlanWeek | null {
  return weeks.find((w) => w.sessions.some((s) => s.state === "open")) ?? weeks.at(-1) ?? null;
}

// The Monday of a week and its Sunday as "31.8.–6.9.", counted from the program's start date (YYYY-MM-DD).
export function weekDates(startDate: string, weekNumber: number): string {
  const start = new Date(`${startDate}T12:00:00Z`);
  const monday = new Date(start.getTime() + (weekNumber - 1) * 7 * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  const short = (d: Date) => `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
  return `${short(monday)}–${short(sunday)}`;
}

// The planned session with this id and the week it is in.
export function findPlanned(weeks: PlanWeek[], plannedId: string): { week: PlanWeek; session: PlannedSession } | null {
  for (const week of weeks) {
    const session = week.sessions.find((s) => s.id === plannedId);
    if (session) return { week, session };
  }
  return null;
}

// A test value as one text: "115 kg" for a 1RM, "45 kg × 58 Wdh." / "1:14" for a best.
export function formatTest(t: ExerciseTest): string {
  const weight = t.weight_kg !== null ? `${formatKg(t.weight_kg)} kg` : "";
  if (t.kind === "one_rm") return weight;
  const values = [t.reps !== null ? `${t.reps} Wdh.` : "", t.distance_m !== null ? `${t.distance_m} m` : "", t.duration_s !== null ? formatDuration(t.duration_s) : ""].filter(Boolean);
  return [weight, ...values].filter(Boolean).join(" × ");
}
