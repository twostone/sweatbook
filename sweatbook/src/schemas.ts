import * as z from "zod";
import { FIELDS } from "./data/exercises.ts";
import type { PlanItemInput } from "./data/programs.ts";

// Request shapes shared by the HTTP API (app.ts) and the MCP tools (mcp.ts).
// Empty string clears an optional text field. The "" branch must come first: a plain z.string() would accept "" itself.
export const optionalText = (max: number) => z.union([z.literal("").transform(() => null), z.string().trim().max(max), z.null()]).optional();

// Any ISO-8601 time with an offset; stored as UTC, so stored times compare as plain strings.
export const isoTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());
export const id = z.uuid();
export const idParam = z.object({ id });

export const MAX_SETS_PER_REQUEST = 20;
export const MAX_EXERCISES_PER_BLOCK = 10;
export const MAX_ALIASES = 10;

export const name = z.string().trim().min(1).max(80);
// Which fields its sets have; that one of them is reps, distance or time is checked in data/exercises.ts.
export const fields = z.array(z.enum(FIELDS)).min(1).max(FIELDS.length);
export const exerciseBody = z.object({
  name,
  fields,
  note: optionalText(1000),
  aliases: z.array(name).max(MAX_ALIASES).optional(),
});
export const exercisePatch = z.object({
  name: name.optional(),
  fields: fields.optional(),
  note: optionalText(1000),
  aliases: z.array(name).max(MAX_ALIASES).optional(),
  archived: z.boolean().optional(),
});

// weight_kg null = bodyweight. Which fields a set needs depends on the exercise and is checked in data/sets.ts.
export const MAX_DISTANCE_M = 1_000_000;
export const setFields = {
  weight_kg: z.number().min(0).max(1000).nullable().optional(),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  duration_s: z.number().int().min(0).max(86400).nullable().optional(),
  distance_m: z.number().int().min(0).max(MAX_DISTANCE_M).nullable().optional(),
  is_max: z.boolean().optional(),
  note: optionalText(500),
};
export const setsBody = z.object({ sets: z.array(z.object(setFields)).min(1).max(MAX_SETS_PER_REQUEST) });
export const setPatch = z.object(setFields);
export const roundBody = z.object({ sets: z.array(z.object({ ...setFields, block_exercise_id: id })).min(1).max(MAX_EXERCISES_PER_BLOCK) });

// ended_at: a training entered afterwards, done at once (it then leaves an open session running).
export const sessionBody = z.object({ title: optionalText(100), started_at: isoTime.optional(), ended_at: isoTime.optional(), note: optionalText(1000) });
export const sessionPatch = z.object({
  title: optionalText(100),
  started_at: isoTime.optional(),
  ended_at: isoTime.nullable().optional(),
  note: optionalText(1000),
});
export const page = z.object({ before: isoTime.optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
export const exerciseRef = z.object({ exercise_id: id });
export const blockExercisePatch = z.object({ note: optionalText(1000) });

// Plan: a range is [min, max] (a fixed number is [n, n]). Which targets an exercise may have is checked in data/programs.ts.
export const MAX_TARGET = 100_000;
export const target = z.number().int().min(0).max(MAX_TARGET);
export const range = z
  .tuple([target, target])
  .refine(([min, max]) => min <= max, "min must not exceed max")
  .nullable()
  .optional();
export const MAX_LOAD_PCT = 500;
export const planItemFields = {
  exercise_id: id.nullable().optional(),
  label: optionalText(80),
  sets: range,
  reps: range,
  distance_m: range,
  duration_s: range,
  to_max: z.boolean().optional(),
  load_kg: z.number().min(0).max(1000).nullable().optional(),
  load_kg_female: z.number().min(0).max(1000).nullable().optional(),
  load_pct: z.number().gt(0).max(MAX_LOAD_PCT).nullable().optional(),
  load_ref_exercise_id: id.nullable().optional(),
  test_kind: z.enum(["one_rm", "best"]).nullable().optional(),
  rest: optionalText(200),
  note: optionalText(1000),
};
export const planItemPatch = z.object(planItemFields);
export const planItemBody = planItemPatch.transform(
  (v): PlanItemInput => ({
    exercise_id: v.exercise_id ?? null,
    label: v.label ?? null,
    sets: v.sets ?? null,
    reps: v.reps ?? null,
    distance_m: v.distance_m ?? null,
    duration_s: v.duration_s ?? null,
    to_max: v.to_max ?? false,
    load_kg: v.load_kg ?? null,
    load_kg_female: v.load_kg_female ?? null,
    load_pct: v.load_pct ?? null,
    load_ref_exercise_id: v.load_ref_exercise_id ?? null,
    test_kind: v.test_kind ?? null,
    rest: v.rest ?? null,
    note: v.note ?? null,
  }),
);
export const day = z.iso.date();
export const programBody = z.object({ name, start_date: day });
export const programPatch = z.object({ name: name.optional(), shared: z.boolean().optional(), start_date: day.optional(), archived: z.boolean().optional() });
export const phase = optionalText(100);
export const weekBody = z.object({ phase, deload: z.boolean().optional(), copy_of: id.optional() });
export const weekPatch = z.object({ phase, deload: z.boolean().optional() });
export const phasePatch = z.object({ name: z.string().trim().min(1).max(100).optional(), note: optionalText(1000) });
export const label = z.string().trim().min(1).max(20);
export const plannedSessionPatch = z.object({ label: label.optional(), skipped: z.boolean().optional(), skip_note: optionalText(100) });
export const MAX_PLAN_ITEMS = 50;
export const testBody = z.object({
  kind: z.enum(["one_rm", "best"]),
  tested_on: day.optional(),
  weight_kg: z.number().min(0).max(1000).nullable().optional(),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  distance_m: z.number().int().min(0).max(MAX_DISTANCE_M).nullable().optional(),
  duration_s: z.number().int().min(0).max(86400).nullable().optional(),
  note: optionalText(500),
});

// The import file. Strict objects, so a misspelled target is an error and not silently ignored.
export const MAX_IMPORT_WEEKS = 200;
export const MAX_IMPORT_SESSIONS = 14;
export const MAX_IMPORT_ITEMS = 50;
export const MAX_IMPORT_ROWS = 200;
export const importRange = z.tuple([target, target]).refine(([min, max]) => min <= max, "min must not exceed max");
export const importKey = z.string().trim().min(1).max(40);
export const importLine = z.union([
  z.strictObject({ text: z.string().trim().min(1).max(1000) }),
  z.strictObject({
    exercise: importKey,
    label: z.string().trim().max(80).optional(),
    sets: importRange.optional(),
    reps: importRange.optional(),
    distance_m: importRange.optional(),
    duration_s: importRange.optional(),
    max: z.boolean().optional(),
    load: z
      .union([
        z.strictObject({ kg: z.number().min(0).max(1000), kg_female: z.number().min(0).max(1000).optional() }),
        z.strictObject({ percent: z.number().gt(0).max(MAX_LOAD_PCT), of: importKey }),
      ])
      .optional(),
    test: z.enum(["one_rm", "best"]).optional(),
    rest: z.string().trim().max(200).optional(),
    note: z.string().trim().max(1000).optional(),
  }),
]);
export const importBody = z.object({
  dry_run: z.boolean().optional(), // check and report, create nothing
  file: z.strictObject({
    program: z.strictObject({ name, start_date: day, start_week: z.number().int().min(1).max(MAX_IMPORT_WEEKS).optional() }),
    exercises: z.array(z.strictObject({ key: importKey, name, fields })).max(MAX_IMPORT_ROWS),
    tests: z
      .array(
        z.strictObject({
          exercise: importKey,
          tested_on: day,
          kind: z.enum(["one_rm", "best"]),
          weight_kg: z.number().min(0).max(1000).optional(),
          reps: z.number().int().min(0).max(1000).optional(),
          distance_m: z.number().int().min(0).max(MAX_DISTANCE_M).optional(),
          duration_s: z.number().int().min(0).max(86400).optional(),
          note: z.string().trim().max(500).optional(),
        }),
      )
      .max(MAX_IMPORT_ROWS)
      .optional(),
    weeks: z
      .array(
        z.strictObject({
          number: z.number().int().min(1).max(MAX_IMPORT_WEEKS),
          phase: z.string().trim().max(100).optional(),
          deload: z.boolean().optional(),
          sessions: z.array(z.strictObject({ label, items: z.array(importLine).max(MAX_IMPORT_ITEMS) })).max(MAX_IMPORT_SESSIONS),
        }),
      )
      .min(1)
      .max(MAX_IMPORT_WEEKS),
  }),
});

export const mePatch = z.object({ sex: z.enum(["male", "female"]).nullable() });
export const tokenBody = z.object({ name: z.string().trim().min(1).max(60), scope: z.enum(["read", "write"]) });

export const plannedSessionStart = z.object({ started_at: isoTime.optional(), ended_at: isoTime.optional() });
