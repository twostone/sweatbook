import { isoNow, transaction, type Db } from "../db.ts";
import { InvalidError, newId, nextPosition, NotFoundError, toBool } from "./common.ts";
import type { Metrics } from "./exercises.ts";

// A logged set. weight_kg null = bodyweight (a value is added weight). A set that exists is done: there is no tick
// before planned sets come in phase 2.
export type SetLog = {
  id: string;
  position: number;
  weight_kg: number | null;
  reps: number | null;
  duration_s: number | null;
  is_max: boolean;
  note: string | null;
  logged_at: string;
};

export type SetInput = { weight_kg?: number | null; reps?: number | null; duration_s?: number | null; is_max?: boolean; note?: string | null };

type SetRow = Omit<SetLog, "is_max"> & { is_max: number };

export const SET_COLUMNS = "l.id, l.position, l.weight_kg, l.reps, l.duration_s, l.is_max, l.note, l.logged_at";

export const toSet = (row: SetRow): SetLog => ({
  id: row.id,
  position: row.position,
  weight_kg: row.weight_kg,
  reps: row.reps,
  duration_s: row.duration_s,
  is_max: toBool(row.is_max),
  note: row.note,
  logged_at: row.logged_at,
});

// Which fields a set must have and which it must not have depends on the exercise. weight_kg may always stay empty
// where it is allowed (bodyweight).
const RULES: Record<Metrics, { required: "reps" | "duration_s"; forbidden: ("weight_kg" | "reps" | "duration_s")[] }> = {
  weight_reps: { required: "reps", forbidden: ["duration_s"] },
  duration: { required: "duration_s", forbidden: ["weight_kg", "reps"] },
  weight_duration: { required: "duration_s", forbidden: ["reps"] },
};

export function checkSet(metrics: Metrics, set: SetInput): void {
  const rule = RULES[metrics];
  if (set[rule.required] === null || set[rule.required] === undefined) throw new InvalidError(`${rule.required} required for ${metrics}`);
  for (const field of rule.forbidden) {
    if (set[field] !== null && set[field] !== undefined) throw new InvalidError(`${field} not allowed for ${metrics}`);
  }
}

// An exercise within a block of one of the user's sessions, with its kind (needed to check sets).
export type OwnedBlockExercise = { id: string; block_id: string; session_id: string; exercise_id: string; metrics: Metrics };

export function ownedBlockExercise(db: Db, userId: string, blockExerciseId: string): OwnedBlockExercise {
  const row = db
    .prepare(
      `SELECT be.id, be.block_id, b.session_id, be.exercise_id, e.metrics
       FROM block_exercise be
       JOIN block b ON b.id = be.block_id
       JOIN session s ON s.id = b.session_id
       JOIN exercise e ON e.id = be.exercise_id
       WHERE be.id = ? AND s.user_id = ?`,
    )
    .get(blockExerciseId, userId) as OwnedBlockExercise | undefined;
  if (!row) throw new NotFoundError("block exercise");
  return row;
}

// Inside a transaction of the caller (SQLite has no nested BEGIN).
export function insertSet(db: Db, owner: OwnedBlockExercise, input: SetInput): string {
  checkSet(owner.metrics, input);
  const id = newId();
  db.prepare(
    `INSERT INTO set_log (id, block_exercise_id, position, weight_kg, reps, duration_s, is_max, note, logged_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    owner.id,
    nextPosition(db, "set_log", "block_exercise_id", owner.id),
    input.weight_kg ?? null,
    input.reps ?? null,
    input.duration_s ?? null,
    input.is_max ? 1 : 0,
    input.note ?? null,
    isoNow(),
  );
  return id;
}

export function getSet(db: Db, id: string): SetLog {
  const row = db.prepare(`SELECT ${SET_COLUMNS} FROM set_log l WHERE l.id = ?`).get(id) as SetRow | undefined;
  if (!row) throw new NotFoundError("set");
  return toSet(row);
}

// Several sets at once: the quick entry "3×5@100" sends three. All or none.
export function addSets(db: Db, userId: string, blockExerciseId: string, inputs: SetInput[]): SetLog[] {
  const ids = transaction(db, () => {
    const owner = ownedBlockExercise(db, userId, blockExerciseId);
    return inputs.map((input) => insertSet(db, owner, input));
  });
  return ids.map((id) => getSet(db, id));
}

function ownedSet(db: Db, userId: string, setId: string): { set: SetLog; owner: OwnedBlockExercise } {
  const row = db.prepare("SELECT block_exercise_id FROM set_log WHERE id = ?").get(setId) as { block_exercise_id: string } | undefined;
  if (!row) throw new NotFoundError("set");
  try {
    return { set: getSet(db, setId), owner: ownedBlockExercise(db, userId, row.block_exercise_id) };
  } catch (e) {
    throw e instanceof NotFoundError ? new NotFoundError("set") : e;
  }
}

// Fields left out stay; the result must still fit the exercise.
export function updateSet(db: Db, userId: string, setId: string, patch: SetInput): SetLog {
  const { set, owner } = ownedSet(db, userId, setId);
  const given = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const merged = { ...set, ...given };
  checkSet(owner.metrics, merged);
  db.prepare("UPDATE set_log SET weight_kg = ?, reps = ?, duration_s = ?, is_max = ?, note = ? WHERE id = ?").run(
    merged.weight_kg,
    merged.reps,
    merged.duration_s,
    merged.is_max ? 1 : 0,
    merged.note,
    setId,
  );
  return getSet(db, setId);
}

export function deleteSet(db: Db, userId: string, setId: string): void {
  ownedSet(db, userId, setId);
  db.prepare("DELETE FROM set_log WHERE id = ?").run(setId);
}
