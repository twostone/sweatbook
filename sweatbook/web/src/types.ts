// Mirrors the API's JSON (src/data/*.ts). Kept separate so the frontend does not depend on backend modules.

// Which fields a set of an exercise has (chosen per exercise). kg is optional (empty = bodyweight); of the others at
// least one is filled.
export type Field = "weight" | "reps" | "distance" | "duration";
export const VALUE_FIELDS: readonly Field[] = ["reps", "distance", "duration"];

export type TokenScope = "read" | "write";
export type ApiToken = { id: string; name: string; scope: TokenScope; created_at: string; last_used_at: string | null };
export type CreatedToken = { token: string; info: ApiToken };

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
  planned: SessionPlanned | null; // the plan line this exercise came from
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
export type SessionTree = Omit<SessionSummary, "block_count" | "set_count"> & { plan: SessionPlan | null; blocks: SessionBlock[] };
// One session's sets of an exercise, for its history (newest first).
export type HistoryEntry = { session_id: string; title: string | null; started_at: string; sets: SetLog[] };

export type SessionPatch = { title?: string | null; started_at?: string; ended_at?: string | null; note?: string | null };

// Programs (plans): a range is [min, max] (a fixed number is [n, n]).
export type Range = [number, number];
export type ExerciseRef = { id: string; name: string; fields: Field[] };
export type TestKind = "one_rm" | "best";

// One line of a planned session. exercise null = a note line ("Aufwärmen"). weight_kg is computed by the server.
export type PlanItem = {
  id: string;
  position: number;
  exercise: ExerciseRef | null;
  label: string | null;
  sets: Range | null;
  reps: Range | null;
  distance_m: Range | null;
  duration_s: Range | null;
  to_max: boolean;
  load_kg: number | null;
  load_pct: number | null;
  load_ref: ExerciseRef | null;
  weight_kg: number | null;
  test_kind: TestKind | null;
  rest: string | null;
  note: string | null;
};

export type ExerciseTest = {
  id: string;
  exercise_id: string;
  tested_on: string; // YYYY-MM-DD
  kind: TestKind;
  weight_kg: number | null;
  reps: number | null;
  distance_m: number | null;
  duration_s: number | null;
  set_id: string | null; // taken from a training set
  note: string | null;
};
export type TestInput = Partial<SetValues> & { kind: TestKind; tested_on?: string; note?: string | null };

export type PlannedState = "done" | "skipped" | "open";
export type PlannedSession = {
  id: string;
  position: number;
  label: string;
  state: PlannedState;
  skip_note: string | null;
  session_id: string | null; // the newest session started from it
  items: PlanItem[];
};
export type PlanPhase = { id: string; name: string; note: string | null };
export type PlanWeek = { id: string; number: number; phase_id: string | null; phase: string | null; deload: boolean; sessions: PlannedSession[] };
export type NextWorkout = { planned_session_id: string; week: number; phase: string | null; label: string };

export type ProgramSummary = {
  id: string;
  name: string;
  start_date: string; // YYYY-MM-DD, the Monday of week 1
  archived: boolean; // the asking user's own, like start_date
  shared: boolean; // every user can join it
  owned: boolean; // only the owner renames, shares and deletes
  joined: boolean; // false = shared by somebody else, not taken up yet
  owner_name: string | null;
  done: number; // planned sessions done or skipped
  total: number;
  next: NextWorkout | null;
};
export type ProgramTree = ProgramSummary & { phases: PlanPhase[]; weeks: PlanWeek[]; tests: (ExerciseTest & { exercise_name: string })[] };
export type ImportResult = { program: ProgramTree; new_exercises: string[] };

// What a session knows of its plan: where it comes from, and per exercise the target.
export type SessionPlan = { planned_session_id: string; program_id: string; program_name: string; week: number; phase: string | null; label: string; notes: string[] };
export type SessionPlanned = PlanItem & { test: ExerciseTest | null }; // test: the value this session's sets produced
