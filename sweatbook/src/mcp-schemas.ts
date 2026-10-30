import * as z from "zod";
import { FIELDS } from "./data/exercises.ts";

// Shapes of the MCP tools, written for a model: described fields with units, names instead of IDs where a person would
// use a name, compact answers. The HTTP API keeps its own shapes (schemas.ts); inputs are normalized in mcp.ts and then
// checked against those, so the limits live in one place.

// ---- inputs ----------------------------------------------------------------------------------------------------

export const uuid = (what: string) => z.string().uuid().describe(`ID of the ${what}`);
export const exerciseRef = z.string().trim().min(1).max(80).describe("The exercise: its name, an alias or its ID (case ignored)");
export const isoTime = z.iso.datetime({ offset: true }).describe("ISO 8601 time with offset, e.g. 2026-10-30T18:30:00+01:00");
export const isoDay = z.iso.date().describe("Date as YYYY-MM-DD");
export const noteText = (max: number, what: string) => z.string().max(max).describe(`${what}. An empty string clears it.`);
export const weeks = z.number().int().min(1).max(52).optional().describe("How many calendar weeks back, including the current one (default 4)");
export const pageBefore = z.iso.datetime({ offset: true }).optional().describe("Only entries started before this time (ISO 8601), to page back");
export const pageLimit = z.number().int().min(1).max(100).optional().describe("Maximum number of entries (default 20)");

const setValues = {
  weight_kg: z.number().min(0).max(1000).nullable().optional().describe("Added weight in kg; leave out or null for bodyweight"),
  reps: z.number().int().min(0).max(1000).nullable().optional().describe("Repetitions"),
  duration_s: z.number().int().min(0).max(86400).nullable().optional().describe("Duration in seconds"),
  distance_m: z.number().int().min(0).max(1_000_000).nullable().optional().describe("Distance in whole metres"),
  is_max: z.boolean().optional().describe("The set was taken to failure / as many as possible"),
  note: z.string().max(500).nullable().optional().describe("Note on the set. An empty string clears it."),
};
const SETS_PER_CALL = 20;
// Only the fields the exercise has may be set; at least one of reps, duration_s, distance_m is needed.
export const setItem = z.object({ count: z.number().int().min(1).max(SETS_PER_CALL).optional().describe("Repeat this set that many times (default 1), e.g. 3 x 5 @ 100 kg"), ...setValues });
export const setList = z.array(setItem).min(1).max(SETS_PER_CALL).describe(`1 to ${SETS_PER_CALL} sets in total (counting repeats)`);
export const singleSet = z.object(setValues);
export const roundSet = z.object({ block_exercise_id: uuid("exercise within the block"), ...setValues });

const target = z.number().int().min(0).max(100_000);
const rangeIn = z
  .union([target, z.tuple([target, target])])
  .nullable()
  .optional();
export const planItemFields = {
  exercise: exerciseRef.nullable().optional().describe("The exercise; leave out for a note line (warm-up, rest advice)"),
  label: z.string().max(80).nullable().optional().describe("Variant of the exercise, e.g. 'with 45 kg, AMRAP'. An empty string clears it."),
  sets: rangeIn.describe("Number of sets: 3 or a range [3, 5]"),
  reps: rangeIn.describe("Repetitions: 5 or a range [5, 8]"),
  distance_m: rangeIn.describe("Distance in metres: 400 or a range"),
  duration_s: rangeIn.describe("Duration in seconds: 60 or a range"),
  to_max: z.boolean().optional().describe("As many as possible instead of a fixed target"),
  load_kg: z.number().min(0).max(1000).nullable().optional().describe("Fixed weight in kg"),
  load_pct: z.number().gt(0).max(500).nullable().optional().describe("Weight as percent of the 1RM of load_ref_exercise"),
  load_ref_exercise: exerciseRef.nullable().optional().describe("The exercise whose newest 1RM load_pct refers to (name, alias or ID)"),
  test_kind: z.enum(["one_rm", "best"]).nullable().optional().describe("The sets of this line produce a test value of that kind"),
  rest: z.string().max(200).nullable().optional().describe("Rest between sets, e.g. '2-3 min'. An empty string clears it."),
  note: z.string().max(1000).nullable().optional().describe("Note on the line. An empty string clears it."),
};

// ---- outputs ---------------------------------------------------------------------------------------------------

const text = z.string();
const maybeText = z.string().nullable();
const maybeNum = z.number().nullable();
const field = z.enum(FIELDS);

export const setView = z.object({
  id: text,
  weight_kg: maybeNum.describe("Added weight; null = bodyweight"),
  reps: maybeNum,
  duration_s: maybeNum,
  distance_m: maybeNum,
  is_max: z.boolean(),
  note: maybeText,
});
export const exerciseView = z.object({
  id: text,
  name: text,
  fields: z.array(field).describe("Which values a set of this exercise has"),
  aliases: z.array(text),
  archived: z.boolean(),
  note: maybeText,
});
const exerciseInSession = z.object({
  block_id: text.describe("Exercises sharing a block_id form a superset"),
  block_exercise_id: text.describe("Pass this to add_sets"),
  exercise_id: text,
  name: text,
  note: maybeText,
  summary: text.describe("The sets in short, e.g. '3×5 @ 100 kg, 1×4 @ 100 kg'"),
  sets: z.array(setView),
  planned: maybeText.describe("The plan target of this exercise, e.g. '3×5–8 @ 80 kg (70 % of Kniebeuge)'"),
  last_time: z.object({ started_at: text, summary: text }).nullable().describe("The previous session with this exercise"),
});
export const sessionView = z.object({
  id: text,
  title: maybeText,
  started_at: text,
  ended_at: maybeText,
  open: z.boolean().describe("Still running (no ended_at)"),
  note: maybeText,
  plan: z.object({ program: text, week: z.number(), phase: maybeText, label: text, notes: z.array(text) }).nullable(),
  exercises: z.array(exerciseInSession),
});
export const sessionListItem = z.object({
  id: text,
  title: maybeText,
  started_at: text,
  ended_at: maybeText,
  open: z.boolean(),
  note: maybeText,
  exercise_count: z.number(),
  set_count: z.number(),
});
export const testView = z.object({
  id: text,
  exercise_id: text,
  exercise: maybeText,
  kind: z.enum(["one_rm", "best"]),
  tested_on: text,
  text: text.describe("e.g. '1RM 140 kg' or 'best 58 @ 45 kg'"),
  note: maybeText,
});
const nextWorkout = z.object({ planned_session_id: text, week: z.number(), phase: maybeText, label: text });
const programBase = {
  id: text,
  name: text,
  start_date: text.describe("Monday of week 1 (your own)"),
  archived: z.boolean(),
  shared: z.boolean(),
  owned: z.boolean().describe("You created it: only you rename, share and delete it"),
  joined: z.boolean().describe("false = shared by somebody else, not joined yet"),
  owner_name: maybeText,
  progress: z.object({ done: z.number(), total: z.number() }).describe("Planned sessions done or skipped / all"),
  next: nextWorkout.nullable().describe("The first open planned session"),
};
export const programListItem = z.object(programBase);
export const programView = z.object({
  ...programBase,
  phases: z.array(z.object({ id: text, name: text, note: maybeText })),
  weeks: z.array(
    z.object({
      id: text,
      number: z.number(),
      phase: maybeText,
      deload: z.boolean(),
      sessions: z.array(
        z.object({
          id: text,
          label: text,
          state: z.enum(["open", "done", "skipped"]),
          skip_note: maybeText,
          session_id: maybeText.describe("The newest training started from it"),
          rows: z.array(
            z.object({
              id: text,
              exercise: maybeText.describe("null for a note line"),
              text: text.describe("The target, e.g. '3×5–8 @ 80 kg (70 % of Kniebeuge); rest 2 min'; the note itself for a note line"),
              note: maybeText,
            }),
          ),
        }),
      ),
    }),
  ),
  tests: z.array(testView),
});
export const historyView = z.object({
  sessions: z.array(z.object({ session_id: text, title: maybeText, started_at: text, summary: text, sets: z.array(setView) })),
});
const topSet = z.object({ weight_kg: maybeNum, reps: maybeNum, duration_s: maybeNum, distance_m: maybeNum }).nullable();
export const progressView = z.object({
  exercise: z.object({ id: text, name: text }),
  sessions: z.array(
    z.object({
      session_id: text,
      started_at: text,
      set_count: z.number(),
      volume_kg: z.number().describe("Σ kg × reps"),
      top_set: topSet,
      est_1rm_kg: maybeNum.describe("Estimated one-rep max (Epley), from sets of 1-12 reps"),
    }),
  ),
  best_est_1rm_kg: maybeNum,
});
export const summaryView = z.object({
  weeks: z.array(
    z.object({
      week_start: text.describe("Monday, YYYY-MM-DD"),
      sessions: z.number(),
      sets: z.number(),
      volume_kg: z.number(),
      exercises: z.array(z.object({ exercise_id: text, name: text, sets: z.number(), volume_kg: z.number() })),
    }),
  ),
});
export const todayView = z.object({
  open_session: sessionView.nullable(),
  next_workouts: z.array(nextWorkout.extend({ program_id: text, program: text })),
});
export const importView = z.object({
  dry_run: z.boolean(),
  program: programListItem.extend({ weeks: z.number(), planned_sessions: z.number() }),
  new_exercises: z.array(text).describe("Exercises the import creates in the catalog"),
});
export const okView = z.object({ ok: z.literal(true) });
