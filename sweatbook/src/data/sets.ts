import { isoNow, transaction, type Db } from "../db.ts";
import { InvalidError, newId, nextPosition, NotFoundError, toBool } from "./common.ts";
import { fieldsOf, FIELDS, SET_COLUMN, VALUE_FIELDS, type Field } from "./exercises.ts";

// A logged set. weight_kg null = bodyweight (a value is added weight). A set that exists is done: there is no tick
// before planned sets come in phase 2.
export type SetLog = {
  id: string;
  position: number;
  weight_kg: number | null;
  reps: number | null;
  duration_s: number | null;
  distance_m: number | null;
  is_max: boolean;
  note: string | null;
  logged_at: string;
};

export type SetInput = {
  weight_kg?: number | null;
  reps?: number | null;
  duration_s?: number | null;
  distance_m?: number | null;
  is_max?: boolean;
  note?: string | null;
};

type SetRow = Omit<SetLog, "is_max"> & { is_max: number };

export const SET_COLUMNS = "l.id, l.position, l.weight_kg, l.reps, l.duration_s, l.distance_m, l.is_max, l.note, l.logged_at";

export const toSet = (row: SetRow): SetLog => ({
  id: row.id,
  position: row.position,
  weight_kg: row.weight_kg,
  reps: row.reps,
  duration_s: row.duration_s,
  distance_m: row.distance_m,
  is_max: toBool(row.is_max),
  note: row.note,
  logged_at: row.logged_at,
});

const filled = (value: unknown) => value !== null && value !== undefined;

// A set may only hold the exercise's fields, and needs a value in at least one of them besides kg (kg empty =
// bodyweight).
export function checkSet(fields: Field[], set: SetInput): void {
  for (const field of FIELDS) {
    if (!fields.includes(field) && filled(set[SET_COLUMN[field]])) throw new InvalidError(`${SET_COLUMN[field]} not allowed`);
  }
  if (!fields.some((f) => VALUE_FIELDS.includes(f) && filled(set[SET_COLUMN[f]]))) {
    throw new InvalidError(`one of ${fields.filter((f) => VALUE_FIELDS.includes(f)).map((f) => SET_COLUMN[f]).join(", ")} required`);
  }
}

// An exercise within a block of one of the user's sessions, with its fields (needed to check sets).
export type OwnedBlockExercise = { id: string; block_id: string; session_id: string; exercise_id: string; fields: Field[] };

export function ownedBlockExercise(db: Db, userId: string, blockExerciseId: string): OwnedBlockExercise {
  const row = db
    .prepare(
      `SELECT be.id, be.block_id, b.session_id, be.exercise_id, e.has_weight, e.has_reps, e.has_distance, e.has_duration
       FROM block_exercise be
       JOIN block b ON b.id = be.block_id
       JOIN session s ON s.id = b.session_id
       JOIN exercise e ON e.id = be.exercise_id
       WHERE be.id = ? AND s.user_id = ?`,
    )
    .get(blockExerciseId, userId) as (Omit<OwnedBlockExercise, "fields"> & Record<string, unknown>) | undefined;
  if (!row) throw new NotFoundError("block exercise");
  return { id: row.id, block_id: row.block_id, session_id: row.session_id, exercise_id: row.exercise_id, fields: fieldsOf(row) };
}

// Inside a transaction of the caller (SQLite has no nested BEGIN).
export function insertSet(db: Db, owner: OwnedBlockExercise, input: SetInput): string {
  checkSet(owner.fields, input);
  const id = newId();
  db.prepare(
    `INSERT INTO set_log (id, block_exercise_id, position, weight_kg, reps, duration_s, distance_m, is_max, note, logged_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    owner.id,
    nextPosition(db, "set_log", "block_exercise_id", owner.id),
    input.weight_kg ?? null,
    input.reps ?? null,
    input.duration_s ?? null,
    input.distance_m ?? null,
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
  checkSet(owner.fields, merged);
  db.prepare("UPDATE set_log SET weight_kg = ?, reps = ?, duration_s = ?, distance_m = ?, is_max = ?, note = ? WHERE id = ?").run(
    merged.weight_kg,
    merged.reps,
    merged.duration_s,
    merged.distance_m,
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
