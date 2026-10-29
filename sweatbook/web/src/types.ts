// Mirrors the API's JSON (src/data/*.ts). Kept separate so the frontend does not depend on backend modules.

// Which fields a set of an exercise has (chosen per exercise). kg is optional (empty = bodyweight); of the others at
// least one is filled.
export type Field = "weight" | "reps" | "distance" | "duration";
export const VALUE_FIELDS: readonly Field[] = ["reps", "distance", "duration"];

export type Me = { id: string; display_name: string | null };

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
export type ExercisePatch = Partial<ExerciseInput> & { archived?: boolean };

// weight_kg null = bodyweight (a value is added weight).
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
// The numbers of a set, as typed or copied: what a draft row and the quick entry produce.
export type SetValues = { weight_kg: number | null; reps: number | null; duration_s: number | null; distance_m: number | null };
export type SetInput = Partial<SetValues> & { is_max?: boolean; note?: string | null };

export type LastTime = { session_id: string; started_at: string; sets: SetLog[] };
export type SessionExercise = {
  id: string; // block_exercise id: sets are added to this
  position: number;
  exercise: { id: string; name: string; fields: Field[]; archived: boolean };
  note: string | null; // for this session only, unlike the catalog note
  sets: SetLog[];
  last_time: LastTime | null;
};
export type SessionBlock = { id: string; position: number; type: "straight" | "superset"; exercises: SessionExercise[] };

export type SessionSummary = {
  id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  block_count: number;
  set_count: number;
};
export type SessionTree = Omit<SessionSummary, "block_count" | "set_count"> & { blocks: SessionBlock[] };
// One session's sets of an exercise, for its history (newest first).
export type HistoryEntry = { session_id: string; title: string | null; started_at: string; sets: SetLog[] };

export type SessionPatch = { title?: string | null; started_at?: string; ended_at?: string | null; note?: string | null };

// Programs (plans). The import answers with the program tree; the list and the preview use only a part of it so far.
export type ProgramSummary = {
  id: string;
  name: string;
  start_date: string;
  archived: boolean;
  done: number; // planned sessions done or skipped
  total: number;
  next: { planned_session_id: string; week: number; phase: string | null; label: string } | null;
};
export type ProgramTree = ProgramSummary & { weeks: { sessions: { items: unknown[] }[] }[]; tests: unknown[] };
export type ImportResult = { program: ProgramTree; new_exercises: string[] };
