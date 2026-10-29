import type { Db } from "../db.ts";
import { toBool } from "./common.ts";
import { fieldsOf, type Field } from "./exercises.ts";
import { latestOneRm, testOfSets, type ExerciseTest, type TestKind } from "./tests.ts";

// One line of a planned session: what to train, with targets. Everything planned is computed when shown, never
// stored per set: the weight of a %-line comes from the newest 1RM, the planned sets from the upper bounds.
export type Range = [number, number]; // [min, max]; a fixed number is [n, n]
export type ExerciseRef = { id: string; name: string; fields: Field[] };

export type PlanItem = {
  id: string;
  position: number;
  exercise: ExerciseRef | null; // null = a note line ("Aufwärmen", "Ruhe vor dem Test")
  label: string | null; // variant of the exercise: "mit 45 kg — AMRAP"
  sets: Range | null;
  reps: Range | null;
  distance_m: Range | null;
  duration_s: Range | null;
  to_max: boolean;
  load_kg: number | null; // fixed load
  load_pct: number | null; // or percent of the 1RM of load_ref …
  load_ref: ExerciseRef | null;
  weight_kg: number | null; // … which gives this weight (rounded), when a 1RM is known
  test_kind: TestKind | null;
  rest: string | null;
  note: string | null;
};

export type PlanItemRow = {
  id: string;
  position: number;
  exercise_id: string | null;
  label: string | null;
  sets_min: number | null;
  sets_max: number | null;
  reps_min: number | null;
  reps_max: number | null;
  distance_min_m: number | null;
  distance_max_m: number | null;
  duration_min_s: number | null;
  duration_max_s: number | null;
  to_max: number;
  load_kg: number | null;
  load_pct: number | null;
  load_ref_exercise_id: string | null;
  test_kind: TestKind | null;
  rest: string | null;
  note: string | null;
};

export const ITEM_COLUMNS =
  "id, position, exercise_id, label, sets_min, sets_max, reps_min, reps_max, distance_min_m, distance_max_m, duration_min_s, duration_max_s, to_max, load_kg, load_pct, load_ref_exercise_id, test_kind, rest, note";

// Weights are plates: rounded to the nearest 2.5 kg.
const PLATE_STEP_KG = 2.5;
export const roundToPlate = (kg: number): number => Math.round(kg / PLATE_STEP_KG) * PLATE_STEP_KG;

const range = (min: number | null, max: number | null): Range | null => (min === null || max === null ? null : [min, max]);

// Exercises and 1RMs are looked up once per request.
export class PlanContext {
  private exercises = new Map<string, ExerciseRef>();
  private oneRms = new Map<string, number | null>();
  constructor(
    readonly db: Db,
    readonly userId: string,
  ) {}

  exercise(id: string | null): ExerciseRef | null {
    if (id === null) return null;
    let ref = this.exercises.get(id);
    if (!ref) {
      const row = this.db.prepare("SELECT id, name, has_weight, has_reps, has_distance, has_duration FROM exercise WHERE id = ? AND user_id = ?").get(id, this.userId) as
        | (Record<string, unknown> & { id: string; name: string })
        | undefined;
      if (!row) return null;
      ref = { id: row.id, name: row.name, fields: fieldsOf(row) };
      this.exercises.set(id, ref);
    }
    return ref;
  }

  oneRm(exerciseId: string, day: string | null): number | null {
    const key = `${exerciseId}|${day}`;
    if (!this.oneRms.has(key)) this.oneRms.set(key, latestOneRm(this.db, exerciseId, day));
    return this.oneRms.get(key) ?? null;
  }
}

// `day` (YYYY-MM-DD) is the training day for a done session; null = the newest 1RM known (for sessions still to come).
export function planItem(ctx: PlanContext, row: PlanItemRow, day: string | null): PlanItem {
  const oneRm = row.load_pct !== null && row.load_ref_exercise_id !== null ? ctx.oneRm(row.load_ref_exercise_id, day) : null;
  return {
    id: row.id,
    position: row.position,
    exercise: ctx.exercise(row.exercise_id),
    label: row.label,
    sets: range(row.sets_min, row.sets_max),
    reps: range(row.reps_min, row.reps_max),
    distance_m: range(row.distance_min_m, row.distance_max_m),
    duration_s: range(row.duration_min_s, row.duration_max_s),
    to_max: toBool(row.to_max),
    load_kg: row.load_kg,
    load_pct: row.load_pct,
    load_ref: ctx.exercise(row.load_ref_exercise_id),
    weight_kg: row.load_kg ?? (oneRm !== null ? roundToPlate((oneRm * row.load_pct!) / 100) : null),
    test_kind: row.test_kind,
    rest: row.rest,
    note: row.note,
  };
}

export type SessionPlanned = PlanItem & { test: ExerciseTest | null }; // test: the value this session's sets produced

// The plan line behind an exercise of a session (null for one added freely).
export function plannedOfBlockExercise(ctx: PlanContext, plannedItemId: string | null, blockExerciseId: string, day: string): SessionPlanned | null {
  if (plannedItemId === null) return null;
  const row = ctx.db.prepare(`SELECT ${ITEM_COLUMNS} FROM planned_item WHERE id = ?`).get(plannedItemId) as PlanItemRow | undefined;
  return row ? { ...planItem(ctx, row, day), test: testOfSets(ctx.db, blockExerciseId) } : null;
}

// Where a session comes from: shown as its heading, with the note lines of the planned session on top.
export type SessionPlan = { planned_session_id: string; program_id: string; program_name: string; week: number; phase: string | null; label: string; notes: string[] };

export function planOfSession(db: Db, plannedSessionId: string | null): SessionPlan | null {
  if (plannedSessionId === null) return null;
  const row = db
    .prepare(
      `SELECT ps.id, ps.label, w.number AS week, w.phase, p.id AS program_id, p.name AS program_name
       FROM planned_session ps JOIN program_week w ON w.id = ps.week_id JOIN program p ON p.id = w.program_id WHERE ps.id = ?`,
    )
    .get(plannedSessionId) as { id: string; label: string; week: number; phase: string | null; program_id: string; program_name: string } | undefined;
  if (!row) return null;
  const notes = db
    .prepare("SELECT note FROM planned_item WHERE planned_session_id = ? AND exercise_id IS NULL AND note IS NOT NULL ORDER BY position")
    .all(plannedSessionId) as { note: string }[];
  return {
    planned_session_id: row.id,
    program_id: row.program_id,
    program_name: row.program_name,
    week: row.week,
    phase: row.phase,
    label: row.label,
    notes: notes.map((n) => n.note),
  };
}
