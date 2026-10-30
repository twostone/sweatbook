import { isoNow, transaction, type Db } from "../db.ts";
import { ConflictError, InvalidError, nameKey, newId, NotFoundError, tidy, toBool } from "./common.ts";

// Which fields a set of this exercise has, chosen per exercise: e.g. kg + reps, time, kg + time (weighted hang),
// kg + distance + time (farmer's walk). Decides the set row in the UI and what the API accepts for a set.
// kg is always optional (empty = bodyweight); of the other fields at least one is needed, so a set says something.
export const FIELDS = ["weight", "reps", "distance", "duration"] as const;
export type Field = (typeof FIELDS)[number];
export const VALUE_FIELDS: readonly Field[] = ["reps", "distance", "duration"];

// The exercise column that says whether its sets have the field.
const FLAG: Record<Field, string> = { weight: "has_weight", reps: "has_reps", distance: "has_distance", duration: "has_duration" };
// The set_log column holding the field's value.
export const SET_COLUMN = { weight: "weight_kg", reps: "reps", distance: "distance_m", duration: "duration_s" } as const satisfies Record<
  Field,
  string
>;

// Duplicates dropped, canonical order; at least one value field.
export function normalizeFields(fields: readonly Field[]): Field[] {
  const result = FIELDS.filter((f) => fields.includes(f));
  if (!result.some((f) => VALUE_FIELDS.includes(f))) throw new InvalidError("fields need reps, distance or duration");
  return result;
}

export type Exercise = {
  id: string;
  name: string;
  fields: Field[];
  note: string | null;
  archived: boolean;
  aliases: string[];
  last_used_at: string | null;
};

export type ExerciseInput = { name: string; fields: Field[]; note?: string | null; aliases?: string[] };
export type ExercisePatch = { name?: string; fields?: Field[]; note?: string | null; aliases?: string[]; archived?: boolean };

type ExerciseRow = {
  id: string;
  name: string;
  has_weight: number;
  has_reps: number;
  has_distance: number;
  has_duration: number;
  note: string | null;
  archived: number;
  last_used_at: string | null;
};

// The catalog is shared by all users; only "last used" is the asking user's own (first parameter).
const EXERCISE_SELECT = `
  SELECT e.id, e.name, e.has_weight, e.has_reps, e.has_distance, e.has_duration, e.note, e.archived,
    (SELECT MAX(s.started_at) FROM block_exercise be
       JOIN block b ON b.id = be.block_id
       JOIN session s ON s.id = b.session_id
      WHERE be.exercise_id = e.id AND s.user_id = ?) AS last_used_at
  FROM exercise e`;

function aliasMap(db: Db): Map<string, string[]> {
  const rows = db.prepare("SELECT exercise_id, alias FROM exercise_alias ORDER BY alias").all() as {
    exercise_id: string;
    alias: string;
  }[];
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.exercise_id, [...(map.get(r.exercise_id) ?? []), r.alias]);
  return map;
}

export const fieldsOf = (row: Record<string, unknown>): Field[] => FIELDS.filter((f) => toBool(row[FLAG[f]] as number));

const toExercise = (row: ExerciseRow, aliases: string[]): Exercise => ({
  id: row.id,
  name: row.name,
  fields: fieldsOf(row),
  note: row.note,
  archived: toBool(row.archived),
  aliases,
  last_used_at: row.last_used_at,
});

// The whole catalog, archived ones included (flagged). Search matches name or alias anywhere, case ignored.
// Most recently used first, never used ones after that by name.
export function listExercises(db: Db, userId: string, query?: string): Exercise[] {
  const aliases = aliasMap(db);
  const rows = db.prepare(EXERCISE_SELECT).all(userId) as ExerciseRow[];
  const key = query ? nameKey(query) : "";
  return rows
    .map((r) => toExercise(r, aliases.get(r.id) ?? []))
    .filter((e) => !key || [e.name, ...e.aliases].some((n) => nameKey(n).includes(key)))
    .sort(
      (a, b) =>
        (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "") || a.name.localeCompare(b.name, "de", { sensitivity: "base" }),
    );
}

export function getExercise(db: Db, userId: string, id: string): Exercise {
  const row = db.prepare(`${EXERCISE_SELECT} WHERE e.id = ?`).get(userId, id) as ExerciseRow | undefined;
  if (!row) throw new NotFoundError("exercise");
  return toExercise(row, aliasMap(db).get(id) ?? []);
}

// Aliases cleaned up: spaces collapsed, duplicates and the exercise's own name dropped.
function cleanAliases(name: string, aliases: string[]): string[] {
  const seen = new Set([nameKey(name)]);
  const result: string[] = [];
  for (const alias of aliases.map(tidy)) {
    if (!seen.has(nameKey(alias))) {
      seen.add(nameKey(alias));
      result.push(alias);
    }
  }
  return result;
}

// A name or alias may stand for one exercise only, across names and aliases of the whole (shared) catalog.
function assertFree(db: Db, texts: string[], exceptId: string | null): void {
  const taken = new Map<string, string>();
  const names = db.prepare("SELECT id, name AS text FROM exercise").all() as { id: string; text: string }[];
  const aliases = db.prepare("SELECT exercise_id AS id, alias AS text FROM exercise_alias").all() as {
    id: string;
    text: string;
  }[];
  for (const t of [...names, ...aliases]) if (t.id !== exceptId) taken.set(nameKey(t.text), t.text);
  for (const text of texts) {
    const clash = taken.get(nameKey(text));
    if (clash) throw new ConflictError("name taken", { name: text, taken_by: clash });
  }
}

function writeAliases(db: Db, userId: string, exerciseId: string, aliases: string[]): void {
  db.prepare("DELETE FROM exercise_alias WHERE exercise_id = ?").run(exerciseId);
  const insert = db.prepare("INSERT INTO exercise_alias (exercise_id, user_id, alias) VALUES (?, ?, ?)");
  for (const alias of aliases) insert.run(exerciseId, userId, alias);
}

// Inside a transaction of the caller. user_id only records who created it.
export function insertExercise(db: Db, userId: string, input: ExerciseInput): string {
  const name = tidy(input.name);
  const aliases = cleanAliases(name, input.aliases ?? []);
  const fields = normalizeFields(input.fields);
  const id = newId();
  assertFree(db, [name, ...aliases], null);
  db.prepare(
    `INSERT INTO exercise (id, user_id, name, has_weight, has_reps, has_distance, has_duration, note, archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, userId, name, ...flags(fields), input.note ?? null, isoNow());
  writeAliases(db, userId, id, aliases);
  return id;
}

export function createExercise(db: Db, userId: string, input: ExerciseInput): Exercise {
  return getExercise(db, userId, transaction(db, () => insertExercise(db, userId, input)));
}

const flags = (fields: Field[]) => FIELDS.map((f) => (fields.includes(f) ? 1 : 0));

// Does any set of the exercise hold a value in this field? Then the field must stay, or the value would be hidden.
function fieldInUse(db: Db, exerciseId: string, field: Field): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS x FROM set_log l JOIN block_exercise be ON be.id = l.block_exercise_id
       WHERE be.exercise_id = ? AND l.${SET_COLUMN[field]} IS NOT NULL LIMIT 1`,
    )
    .get(exerciseId);
  return row !== undefined;
}

// Fields left out stay as they are; `aliases` replaces the whole list.
export function updateExercise(db: Db, userId: string, id: string, patch: ExercisePatch): Exercise {
  transaction(db, () => {
    const current = getExercise(db, userId, id);
    const name = patch.name !== undefined ? tidy(patch.name) : current.name;
    const aliases = cleanAliases(name, patch.aliases ?? current.aliases);
    if (patch.name !== undefined || patch.aliases !== undefined) assertFree(db, [name, ...aliases], id);
    // A field may be added any time (old sets leave it empty); it may only go while no set has a value in it.
    const fields = patch.fields !== undefined ? normalizeFields(patch.fields) : current.fields;
    const kept = current.fields.filter((f) => !fields.includes(f) && fieldInUse(db, id, f));
    if (kept.length) throw new ConflictError("field in use", { field: kept[0], fields: kept });
    db.prepare(
      `UPDATE exercise SET name = ?, has_weight = ?, has_reps = ?, has_distance = ?, has_duration = ?, note = ?, archived = ?
       WHERE id = ?`,
    ).run(
      name,
      ...flags(fields),
      patch.note !== undefined ? patch.note : current.note,
      (patch.archived ?? current.archived) ? 1 : 0,
      id,
    );
    writeAliases(db, userId, id, aliases);
  });
  return getExercise(db, userId, id);
}

// Exercises are never deleted while sets point at them (ON DELETE RESTRICT): archive instead. An unused one may go.
export function deleteExercise(db: Db, userId: string, id: string): void {
  getExercise(db, userId, id);
  const used =
    db.prepare("SELECT 1 AS x FROM block_exercise WHERE exercise_id = ? LIMIT 1").get(id) ??
    db.prepare("SELECT 1 AS x FROM planned_item WHERE exercise_id = ? OR load_ref_exercise_id = ? LIMIT 1").get(id, id);
  if (used) throw new ConflictError("exercise in use");
  db.prepare("DELETE FROM exercise WHERE id = ?").run(id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CANDIDATES = 5;

// An exercise named by a person or an agent: its ID, or its exact name or alias (case ignored). Never guesses and never
// creates: an unknown name is an error that lists similar ones, so the caller can pick or create the exercise itself.
export function resolveExercise(db: Db, userId: string, ref: string): Exercise {
  const text = tidy(ref);
  if (UUID.test(text)) return getExercise(db, userId, text);
  const key = nameKey(text);
  const all = listExercises(db, userId);
  const found = all.find((e) => [e.name, ...e.aliases].some((n) => nameKey(n) === key));
  if (found) return found;
  const similar = all.filter((e) => [e.name, ...e.aliases].some((n) => nameKey(n).includes(key))).slice(0, MAX_CANDIDATES);
  throw new InvalidError(`unknown exercise "${text}"${similar.length ? `; similar: ${similar.map((e) => e.name).join(", ")}` : "; create it with create_exercise"}`);
}

export function assertUsable(exercise: Exercise): void {
  if (exercise.archived) throw new ConflictError("exercise archived");
}
