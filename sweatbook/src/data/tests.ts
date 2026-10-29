import type { Db } from "../db.ts";
import { InvalidError, newId, NotFoundError } from "./common.ts";
import { FIELDS, getExercise, SET_COLUMN, VALUE_FIELDS } from "./exercises.ts";

// A test value of an exercise: a 1RM (drives the %-weights of a plan) or a best performance (45 kg × 58 reps, 74 s).
// Its values are those of a set of the exercise. One taken from a training set carries set_id and goes with that set.
export type TestKind = "one_rm" | "best";
export type ExerciseTest = {
  id: string;
  exercise_id: string;
  tested_on: string; // YYYY-MM-DD
  kind: TestKind;
  weight_kg: number | null;
  reps: number | null;
  distance_m: number | null;
  duration_s: number | null;
  set_id: string | null;
  note: string | null;
};

export type TestInput = {
  kind: TestKind;
  tested_on?: string;
  weight_kg?: number | null;
  reps?: number | null;
  distance_m?: number | null;
  duration_s?: number | null;
  note?: string | null;
};

export const TEST_COLUMNS = "t.id, t.exercise_id, t.tested_on, t.kind, t.weight_kg, t.reps, t.distance_m, t.duration_s, t.set_id, t.note";

const filled = (value: unknown) => value !== null && value !== undefined;

export function listTests(db: Db, userId: string, exerciseId: string): ExerciseTest[] {
  getExercise(db, userId, exerciseId);
  return db
    .prepare(`SELECT ${TEST_COLUMNS} FROM exercise_test t WHERE t.exercise_id = ? AND t.user_id = ? ORDER BY t.tested_on DESC, t.rowid DESC`)
    .all(exerciseId, userId) as ExerciseTest[];
}

export function createTest(db: Db, userId: string, exerciseId: string, input: TestInput): ExerciseTest {
  const exercise = getExercise(db, userId, exerciseId);
  for (const field of FIELDS) {
    if (!exercise.fields.includes(field) && filled(input[SET_COLUMN[field]])) throw new InvalidError(`${SET_COLUMN[field]} not allowed`);
  }
  if (input.kind === "one_rm" && !filled(input.weight_kg)) throw new InvalidError("a 1RM needs weight_kg");
  if (input.kind === "best" && !VALUE_FIELDS.some((f) => filled(input[SET_COLUMN[f]]))) {
    throw new InvalidError("a best needs reps, distance_m or duration_s");
  }
  const id = newId();
  db.prepare(
    "INSERT INTO exercise_test (id, user_id, exercise_id, tested_on, kind, weight_kg, reps, distance_m, duration_s, set_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
  ).run(
    id,
    userId,
    exerciseId,
    input.tested_on ?? new Date().toISOString().slice(0, 10),
    input.kind,
    input.weight_kg ?? null,
    input.reps ?? null,
    input.distance_m ?? null,
    input.duration_s ?? null,
    input.note ?? null,
  );
  return db.prepare(`SELECT ${TEST_COLUMNS} FROM exercise_test t WHERE t.id = ?`).get(id) as ExerciseTest;
}

// "Rückgängig" also works for a test taken from a set: the set stays, and the test returns only when its sets change.
export function deleteTest(db: Db, userId: string, id: string): void {
  const row = db.prepare("SELECT id FROM exercise_test WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) throw new NotFoundError("test");
  db.prepare("DELETE FROM exercise_test WHERE id = ?").run(id);
}

// The newest 1RM up to and including `day` (null = the newest known), or null when there is none.
export function latestOneRm(db: Db, userId: string, exerciseId: string, day: string | null): number | null {
  const row = db
    .prepare(
      `SELECT weight_kg FROM exercise_test
       WHERE user_id = ? AND exercise_id = ? AND kind = 'one_rm' AND weight_kg IS NOT NULL AND (? IS NULL OR tested_on <= ?)
       ORDER BY tested_on DESC, rowid DESC LIMIT 1`,
    )
    .get(userId, exerciseId, day, day) as { weight_kg: number } | undefined;
  return row?.weight_kg ?? null;
}

type SetValues = { id: string; weight_kg: number | null; reps: number | null; distance_m: number | null; duration_s: number | null };

// Best performance: most reps, then longest distance, then longest time (an exercise rarely has more than one of them).
const performance = (s: SetValues): number[] => [s.reps ?? -1, s.distance_m ?? -1, s.duration_s ?? -1];
function beats(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

// A plan line with a test kind keeps one test value up to date: the best set of that exercise in the session.
// Called after every change to the sets of a block exercise, inside the caller's transaction.
export function syncSessionTest(db: Db, blockExerciseId: string): void {
  const row = db
    .prepare(
      `SELECT pi.test_kind, s.started_at, s.user_id, be.exercise_id FROM block_exercise be
       JOIN planned_item pi ON pi.id = be.planned_item_id
       JOIN block b ON b.id = be.block_id JOIN session s ON s.id = b.session_id
       WHERE be.id = ?`,
    )
    .get(blockExerciseId) as { test_kind: TestKind | null; started_at: string; user_id: string; exercise_id: string } | undefined;
  if (!row?.test_kind) return;
  db.prepare("DELETE FROM exercise_test WHERE set_id IN (SELECT id FROM set_log WHERE block_exercise_id = ?)").run(blockExerciseId);
  const sets = db
    .prepare("SELECT id, weight_kg, reps, distance_m, duration_s FROM set_log WHERE block_exercise_id = ? ORDER BY position")
    .all(blockExerciseId) as SetValues[];
  let best: SetValues | null = null;
  for (const set of sets) {
    if (row.test_kind === "one_rm") {
      if (set.weight_kg !== null && (best === null || set.weight_kg > best.weight_kg!)) best = set;
    } else if (best === null || beats(performance(set), performance(best))) best = set;
  }
  if (!best) return;
  db.prepare(
    "INSERT INTO exercise_test (id, user_id, exercise_id, tested_on, kind, weight_kg, reps, distance_m, duration_s, set_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
  ).run(newId(), row.user_id, row.exercise_id, row.started_at.slice(0, 10), row.test_kind, best.weight_kg, best.reps, best.distance_m, best.duration_s, best.id);
}

// The test value the sets of a block exercise produced (shown as "Neuer Testwert · Rückgängig").
export function testOfSets(db: Db, blockExerciseId: string): ExerciseTest | null {
  const row = db
    .prepare(`SELECT ${TEST_COLUMNS} FROM exercise_test t JOIN set_log l ON l.id = t.set_id WHERE l.block_exercise_id = ? LIMIT 1`)
    .get(blockExerciseId) as ExerciseTest | undefined;
  return row ?? null;
}
