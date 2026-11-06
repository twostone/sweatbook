import type { Db } from "../db.ts";
import { getExercise, muscleMap } from "./exercises.ts";
import { InvalidError } from "./common.ts";
import { muscleSummary, noMuscles, type Muscles, type MuscleSummary } from "./muscles.ts";

// Evaluations over the logged sets of one user, read-only. Computed when asked, nothing is stored.
export const DEFAULT_WEEKS = 4;
const DAYS_PER_WEEK = 7;
// Epley's estimate is only meaningful for lower rep counts.
const MAX_REPS_FOR_ESTIMATE = 12;
const REPS_PER_ESTIMATE_STEP = 30;
const E1RM_STEP_KG = 0.5;

export type SetPoint = { weight_kg: number | null; reps: number | null; duration_s: number | null; distance_m: number | null };

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

// Estimated one-rep max (Epley) of a set, or null for a set that says little about it (bodyweight, many reps).
export function estimatedOneRm(set: SetPoint): number | null {
  if (!set.weight_kg || !set.reps || set.reps > MAX_REPS_FOR_ESTIMATE) return null;
  return roundTo(set.reps === 1 ? set.weight_kg : set.weight_kg * (1 + set.reps / REPS_PER_ESTIMATE_STEP), E1RM_STEP_KG);
}

// Σ kg × reps; bodyweight sets (no kg) add nothing.
export const volumeOf = (sets: SetPoint[]): number => sets.reduce((sum, s) => sum + (s.weight_kg && s.reps ? s.weight_kg * s.reps : 0), 0);

// The heaviest set, then most reps, distance, time.
export function topSet<T extends SetPoint>(sets: T[]): T | null {
  const key = (s: SetPoint) => [s.weight_kg ?? 0, s.reps ?? 0, s.distance_m ?? 0, s.duration_s ?? 0];
  let best: T | null = null;
  for (const s of sets) {
    if (!best) best = s;
    else {
      const a = key(s);
      const b = key(best);
      const i = a.findIndex((v, n) => v !== b[n]);
      if (i >= 0 && a[i]! > b[i]!) best = s;
    }
  }
  return best;
}

const pad = (n: number) => String(n).padStart(2, "0");
// The local calendar day of a timestamp (the process runs in the user's time zone), as YYYY-MM-DD.
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Monday of the week of a date, as YYYY-MM-DD.
function mondayOf(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % DAYS_PER_WEEK));
  return dayOf(monday);
}
const addDays = (day: string, days: number): string => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayOf(d);
};
// The Mondays of the last `weeks` weeks including the current one, oldest first.
function weekStarts(weeks: number, now: Date): string[] {
  const current = mondayOf(now);
  return Array.from({ length: weeks }, (_, i) => addDays(current, -DAYS_PER_WEEK * (weeks - 1 - i)));
}

type Row = SetPoint & { session_id: string; started_at: string; exercise_id: string; name: string };

// Local midnight of a day, as the UTC string the table holds.
const localMidnight = (day: string) => new Date(`${day}T00:00:00`).toISOString();

// Sets of sessions started from fromDay up to and including toDay (null = open end), local days.
function rowsBetween(db: Db, userId: string, fromDay: string, toDay: string | null, exerciseId?: string): Row[] {
  const since = localMidnight(fromDay);
  const until = toDay === null ? null : localMidnight(addDays(toDay, 1));
  return db
    .prepare(
      `SELECT s.id AS session_id, s.started_at, be.exercise_id, e.name, l.weight_kg, l.reps, l.duration_s, l.distance_m
       FROM set_log l
       JOIN block_exercise be ON be.id = l.block_exercise_id
       JOIN block b ON b.id = be.block_id
       JOIN session s ON s.id = b.session_id
       JOIN exercise e ON e.id = be.exercise_id
       WHERE s.user_id = ? AND s.started_at >= ? AND (? IS NULL OR s.started_at < ?) AND (? IS NULL OR be.exercise_id = ?)
       ORDER BY s.started_at, l.position`,
    )
    .all(userId, since, until, until, exerciseId ?? null, exerciseId ?? null) as Row[];
}

export type Totals = {
  sessions: number;
  sets: number;
  volume_kg: number;
  exercises: { exercise_id: string; name: string; sets: number; volume_kg: number }[];
  muscles: MuscleSummary;
};

// What a week and a period report alike, so both count the same way.
function totalsOf(rows: Row[], musclesOf: (exerciseId: string) => Muscles): Totals {
  const byExercise = new Map<string, Row[]>();
  for (const r of rows) byExercise.set(r.exercise_id, [...(byExercise.get(r.exercise_id) ?? []), r]);
  return {
    sessions: new Set(rows.map((r) => r.session_id)).size,
    sets: rows.length,
    volume_kg: volumeOf(rows),
    exercises: [...byExercise.entries()]
      .map(([exercise_id, sets]) => ({ exercise_id, name: sets[0]!.name, sets: sets.length, volume_kg: volumeOf(sets) }))
      .sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name, "de")),
    muscles: muscleSummary(rows, musclesOf),
  };
}

function catalogMuscles(db: Db): (exerciseId: string) => Muscles {
  const muscles = muscleMap(db);
  return (id) => muscles.get(id) ?? noMuscles();
}

export type TrainingWeek = Totals & { week_start: string }; // Monday, YYYY-MM-DD

// Per week (oldest first, empty weeks included so gaps show): sessions, sets, volume, the same per exercise, and weighted
// sets per muscle group.
export function trainingSummary(db: Db, userId: string, opts: { weeks?: number; now?: Date } = {}): { weeks: TrainingWeek[] } {
  const starts = weekStarts(opts.weeks ?? DEFAULT_WEEKS, opts.now ?? new Date());
  const rows = rowsBetween(db, userId, starts[0]!, null);
  const musclesOf = catalogMuscles(db);
  return {
    weeks: starts.map((week_start) => ({
      week_start,
      ...totalsOf(rows.filter((r) => mondayOf(new Date(r.started_at)) === week_start), musclesOf),
    })),
  };
}

// A guard against accidental huge queries; a year covers any plan phase or season.
export const MAX_PERIOD_DAYS = 366;
const MS_PER_DAY = 86_400_000;

export type PeriodSummary = Totals & { from: string; to: string; days: number };

// The same totals for any span of local days, both ends included (e.g. a plan phase or a month).
export function periodSummary(db: Db, userId: string, period: { from: string; to: string }): PeriodSummary {
  const { from, to } = period;
  if (from > to) throw new InvalidError("from must not be after to");
  // Noon avoids daylight-saving shifts in the day count.
  const days = Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / MS_PER_DAY) + 1;
  if (days > MAX_PERIOD_DAYS) throw new InvalidError(`a period spans at most ${MAX_PERIOD_DAYS} days`);
  return { from, to, days, ...totalsOf(rowsBetween(db, userId, from, to), catalogMuscles(db)) };
}

export type ProgressSession = {
  session_id: string;
  started_at: string;
  set_count: number;
  volume_kg: number;
  top_set: SetPoint | null;
  est_1rm_kg: number | null;
};

// How one exercise developed over the last weeks, one entry per session (newest first), with the best estimated 1RM.
export function exerciseProgress(
  db: Db,
  userId: string,
  exerciseId: string,
  opts: { weeks?: number; now?: Date } = {},
): { exercise: { id: string; name: string }; sessions: ProgressSession[]; best_est_1rm_kg: number | null } {
  const exercise = getExercise(db, userId, exerciseId);
  const rows = rowsBetween(db, userId, weekStarts(opts.weeks ?? DEFAULT_WEEKS, opts.now ?? new Date())[0]!, null, exerciseId);
  const bySession = new Map<string, Row[]>();
  for (const r of rows) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);
  const sessions = [...bySession.values()]
    .map((sets): ProgressSession => {
      const top = topSet(sets);
      const estimates = sets.map(estimatedOneRm).filter((v): v is number => v !== null);
      return {
        session_id: sets[0]!.session_id,
        started_at: sets[0]!.started_at,
        set_count: sets.length,
        volume_kg: volumeOf(sets),
        top_set: top && { weight_kg: top.weight_kg, reps: top.reps, duration_s: top.duration_s, distance_m: top.distance_m },
        est_1rm_kg: estimates.length ? Math.max(...estimates) : null,
      };
    })
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const all = sessions.map((s) => s.est_1rm_kg).filter((v): v is number => v !== null);
  return { exercise: { id: exercise.id, name: exercise.name }, sessions, best_est_1rm_kg: all.length ? Math.max(...all) : null };
}
