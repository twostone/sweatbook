// Mirrors the API's JSON (src/data/*.ts). Kept separate so the frontend does not depend on backend modules.

export type Metrics = "weight_reps" | "duration" | "weight_duration";

export type Me = { id: string; display_name: string | null };

export type Exercise = {
  id: string;
  name: string;
  metrics: Metrics;
  note: string | null;
  archived: boolean;
  aliases: string[];
  last_used_at: string | null;
};
export type ExerciseInput = { name: string; metrics: Metrics; note?: string | null; aliases?: string[] };

// weight_kg null = bodyweight (a value is added weight).
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
// The numbers of a set, as typed or copied: what a draft row and the quick entry produce.
export type SetValues = { weight_kg: number | null; reps: number | null; duration_s: number | null };
export type SetInput = Partial<SetValues> & { is_max?: boolean; note?: string | null };

export type LastTime = { session_id: string; started_at: string; sets: SetLog[] };
export type SessionExercise = {
  id: string; // block_exercise id: sets are added to this
  position: number;
  exercise: { id: string; name: string; metrics: Metrics; archived: boolean };
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
export type SessionPatch = { title?: string | null; started_at?: string; ended_at?: string | null; note?: string | null };
