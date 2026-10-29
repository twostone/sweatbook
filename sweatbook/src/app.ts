import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { zValidator } from "@hono/zod-validator";
import * as z from "zod";
import type { Db } from "./db.ts";
import { addBlock, addExerciseToBlock, addRound, deleteBlock, removeBlockExercise, setBlockOrder, updateBlockExercise } from "./data/blocks.ts";
import { ConflictError, InvalidError, NotFoundError } from "./data/common.ts";
import {
  addPlanItem,
  addPlannedSession,
  addWeek,
  createProgram,
  deletePhase,
  deletePlanItem,
  deletePlannedSession,
  deleteProgram,
  deleteWeek,
  getProgram,
  listPrograms,
  setItemOrder,
  startPlannedSession,
  updatePlanItem,
  updatePlannedSession,
  updatePhase,
  updateProgram,
  updateWeek,
  type PlanItemInput,
} from "./data/programs.ts";
import { importProgram } from "./data/import.ts";
import { createTest, deleteTest, listTests } from "./data/tests.ts";
import { createExercise, deleteExercise, FIELDS, getExercise, listExercises, updateExercise } from "./data/exercises.ts";
import { createSession, deleteSession, exerciseHistory, getSession, listSessions, updateSession } from "./data/sessions.ts";
import { addSets, deleteSet, updateSet } from "./data/sets.ts";
import { resolveUser, type User } from "./data/users.ts";
import { logger } from "./log.ts";

// Empty string clears an optional text field. The "" branch must come first: a plain z.string() would accept "" itself.
const optionalText = (max: number) => z.union([z.literal("").transform(() => null), z.string().trim().max(max), z.null()]).optional();

// Any ISO-8601 time with an offset; stored as UTC, so stored times compare as plain strings.
const isoTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());
const id = z.uuid();
const idParam = z.object({ id });

const MAX_SETS_PER_REQUEST = 20;
const MAX_EXERCISES_PER_BLOCK = 10;
const MAX_ALIASES = 10;

const name = z.string().trim().min(1).max(80);
// Which fields its sets have; that one of them is reps, distance or time is checked in data/exercises.ts.
const fields = z.array(z.enum(FIELDS)).min(1).max(FIELDS.length);
const exerciseBody = z.object({
  name,
  fields,
  note: optionalText(1000),
  aliases: z.array(name).max(MAX_ALIASES).optional(),
});
const exercisePatch = z.object({
  name: name.optional(),
  fields: fields.optional(),
  note: optionalText(1000),
  aliases: z.array(name).max(MAX_ALIASES).optional(),
  archived: z.boolean().optional(),
});

// weight_kg null = bodyweight. Which fields a set needs depends on the exercise and is checked in data/sets.ts.
const MAX_DISTANCE_M = 1_000_000;
const setFields = {
  weight_kg: z.number().min(0).max(1000).nullable().optional(),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  duration_s: z.number().int().min(0).max(86400).nullable().optional(),
  distance_m: z.number().int().min(0).max(MAX_DISTANCE_M).nullable().optional(),
  is_max: z.boolean().optional(),
  note: optionalText(500),
};
const setsBody = z.object({ sets: z.array(z.object(setFields)).min(1).max(MAX_SETS_PER_REQUEST) });
const setPatch = z.object(setFields);
const roundBody = z.object({ sets: z.array(z.object({ ...setFields, block_exercise_id: id })).min(1).max(MAX_EXERCISES_PER_BLOCK) });

// ended_at: a training entered afterwards, done at once (it then leaves an open session running).
const sessionBody = z.object({ title: optionalText(100), started_at: isoTime.optional(), ended_at: isoTime.optional(), note: optionalText(1000) });
const sessionPatch = z.object({
  title: optionalText(100),
  started_at: isoTime.optional(),
  ended_at: isoTime.nullable().optional(),
  note: optionalText(1000),
});
const page = z.object({ before: isoTime.optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
const exerciseRef = z.object({ exercise_id: id });
const blockExercisePatch = z.object({ note: optionalText(1000) });

// Plan: a range is [min, max] (a fixed number is [n, n]). Which targets an exercise may have is checked in data/programs.ts.
const MAX_TARGET = 100_000;
const target = z.number().int().min(0).max(MAX_TARGET);
const range = z
  .tuple([target, target])
  .refine(([min, max]) => min <= max, "min must not exceed max")
  .nullable()
  .optional();
const MAX_LOAD_PCT = 500;
const planItemFields = {
  exercise_id: id.nullable().optional(),
  label: optionalText(80),
  sets: range,
  reps: range,
  distance_m: range,
  duration_s: range,
  to_max: z.boolean().optional(),
  load_kg: z.number().min(0).max(1000).nullable().optional(),
  load_pct: z.number().gt(0).max(MAX_LOAD_PCT).nullable().optional(),
  load_ref_exercise_id: id.nullable().optional(),
  test_kind: z.enum(["one_rm", "best"]).nullable().optional(),
  rest: optionalText(200),
  note: optionalText(1000),
};
const planItemPatch = z.object(planItemFields);
const planItemBody = planItemPatch.transform(
  (v): PlanItemInput => ({
    exercise_id: v.exercise_id ?? null,
    label: v.label ?? null,
    sets: v.sets ?? null,
    reps: v.reps ?? null,
    distance_m: v.distance_m ?? null,
    duration_s: v.duration_s ?? null,
    to_max: v.to_max ?? false,
    load_kg: v.load_kg ?? null,
    load_pct: v.load_pct ?? null,
    load_ref_exercise_id: v.load_ref_exercise_id ?? null,
    test_kind: v.test_kind ?? null,
    rest: v.rest ?? null,
    note: v.note ?? null,
  }),
);
const day = z.iso.date();
const programBody = z.object({ name, start_date: day });
const programPatch = z.object({ name: name.optional(), start_date: day.optional(), archived: z.boolean().optional() });
const phase = optionalText(100);
const weekBody = z.object({ phase, deload: z.boolean().optional(), copy_of: id.optional() });
const weekPatch = z.object({ phase, deload: z.boolean().optional() });
const phasePatch = z.object({ name: z.string().trim().min(1).max(100).optional(), note: optionalText(1000) });
const label = z.string().trim().min(1).max(20);
const plannedSessionPatch = z.object({ label: label.optional(), skipped: z.boolean().optional(), skip_note: optionalText(100) });
const MAX_PLAN_ITEMS = 50;
const testBody = z.object({
  kind: z.enum(["one_rm", "best"]),
  tested_on: day.optional(),
  weight_kg: z.number().min(0).max(1000).nullable().optional(),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  distance_m: z.number().int().min(0).max(MAX_DISTANCE_M).nullable().optional(),
  duration_s: z.number().int().min(0).max(86400).nullable().optional(),
  note: optionalText(500),
});

// The import file. Strict objects, so a misspelled target is an error and not silently ignored.
const MAX_IMPORT_WEEKS = 200;
const MAX_IMPORT_SESSIONS = 14;
const MAX_IMPORT_ITEMS = 50;
const MAX_IMPORT_ROWS = 200;
const importRange = z.tuple([target, target]).refine(([min, max]) => min <= max, "min must not exceed max");
const importKey = z.string().trim().min(1).max(40);
const importLine = z.union([
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
        z.strictObject({ kg: z.number().min(0).max(1000) }),
        z.strictObject({ percent: z.number().gt(0).max(MAX_LOAD_PCT), of: importKey }),
      ])
      .optional(),
    test: z.enum(["one_rm", "best"]).optional(),
    rest: z.string().trim().max(200).optional(),
    note: z.string().trim().max(1000).optional(),
  }),
]);
const importBody = z.object({
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

export type AppOptions = {
  // If set, only connections from this IP are served. HA ingress always connects from 172.30.32.2 (Supervisor);
  // everything else on the network must be refused, otherwise the X-Remote-User-* headers could be forged.
  allowedIp?: string;
};

type Env = { Variables: { user: User } };

const log = logger("app");
// A request is only logged when it failed or took this long.
const SLOW_REQUEST_MS = 2000;

export function createApp(db: Db, opts: AppOptions = {}) {
  const app = new Hono<Env>();

  // First in line, so refused requests show up as well. Path only, never the query string.
  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    const ms = Math.round(performance.now() - t0);
    const status = c.res.status;
    if (status >= 400 || ms >= SLOW_REQUEST_MS) {
      (status >= 500 ? log.error : log.warn)("request", { method: c.req.method, path: c.req.path, status, ms });
    }
  });

  if (opts.allowedIp) {
    app.use("*", async (c, next) => {
      let addr: string | undefined;
      try {
        addr = getConnInfo(c).remote.address?.replace(/^::ffff:/, "");
      } catch {
        // no connection info available -> fail closed
      }
      if (addr !== opts.allowedIp) return c.text("Forbidden", 403);
      await next();
    });
  }

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: `${err.message} not found` }, 404);
    if (err instanceof ConflictError) return c.json({ error: err.message, ...err.detail }, 409);
    if (err instanceof InvalidError) return c.json({ error: err.message }, 400);
    log.error("unhandled", { method: c.req.method, path: c.req.path, err, stack: err instanceof Error ? err.stack : undefined });
    return c.json({ error: "internal error" }, 500);
  });

  // Who is asking: HA ingress passes the logged-in user (X-Remote-User-*). Every piece of data belongs to that user.
  // Trustworthy only because the ingress guard above lets nobody else in. No header -> no data (fail closed).
  // The one place that knows where the identity comes from: a later login without HA (e.g. Cloudflare Access) goes here.
  app.use("/api/*", async (c, next) => {
    const haUserId = c.req.header("X-Remote-User-Id");
    if (!haUserId) return c.json({ error: "no user" }, 401);
    c.set("user", resolveUser(db, haUserId, c.req.header("X-Remote-User-Display-Name") ?? null));
    await next();
  });

  app.get("/api/me", (c) => c.json(c.get("user")));

  // Exercise catalog
  app.get("/api/exercises", (c) => c.json(listExercises(db, c.get("user").id, c.req.query("q"))));
  app.post("/api/exercises", zValidator("json", exerciseBody), (c) => c.json(createExercise(db, c.get("user").id, c.req.valid("json")), 201));
  app.get("/api/exercises/:id", zValidator("param", idParam), (c) => c.json(getExercise(db, c.get("user").id, c.req.valid("param").id)));
  app.patch("/api/exercises/:id", zValidator("param", idParam), zValidator("json", exercisePatch), (c) =>
    c.json(updateExercise(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json"))),
  );
  app.delete("/api/exercises/:id", zValidator("param", idParam), (c) => {
    deleteExercise(db, c.get("user").id, c.req.valid("param").id);
    return c.body(null, 204);
  });
  app.get("/api/exercises/:id/history", zValidator("param", idParam), zValidator("query", page), (c) =>
    c.json(exerciseHistory(db, c.get("user").id, c.req.valid("param").id, c.req.valid("query"))),
  );

  // Sessions
  app.get("/api/sessions", zValidator("query", page), (c) => c.json(listSessions(db, c.get("user").id, c.req.valid("query"))));
  app.post("/api/sessions", zValidator("json", sessionBody), (c) => c.json(createSession(db, c.get("user").id, c.req.valid("json")), 201));
  app.get("/api/sessions/:id", zValidator("param", idParam), (c) => c.json(getSession(db, c.get("user").id, c.req.valid("param").id)));
  app.patch("/api/sessions/:id", zValidator("param", idParam), zValidator("json", sessionPatch), (c) =>
    c.json(updateSession(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json"))),
  );
  app.delete("/api/sessions/:id", zValidator("param", idParam), (c) => {
    deleteSession(db, c.get("user").id, c.req.valid("param").id);
    return c.body(null, 204);
  });

  // Blocks: they answer with the whole session, so the client simply replaces what it shows.
  app.post("/api/sessions/:id/blocks", zValidator("param", idParam), zValidator("json", exerciseRef), (c) =>
    c.json(addBlock(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json").exercise_id), 201),
  );
  app.put("/api/sessions/:id/block-order", zValidator("param", idParam), zValidator("json", z.object({ block_ids: z.array(id).max(100) })), (c) =>
    c.json(setBlockOrder(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json").block_ids)),
  );
  app.post("/api/blocks/:id/exercises", zValidator("param", idParam), zValidator("json", exerciseRef), (c) =>
    c.json(addExerciseToBlock(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json").exercise_id), 201),
  );
  app.post("/api/blocks/:id/rounds", zValidator("param", idParam), zValidator("json", roundBody), (c) =>
    c.json(addRound(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json").sets), 201),
  );
  app.delete("/api/blocks/:id", zValidator("param", idParam), (c) => c.json(deleteBlock(db, c.get("user").id, c.req.valid("param").id)));
  app.patch("/api/block-exercises/:id", zValidator("param", idParam), zValidator("json", blockExercisePatch), (c) =>
    c.json(updateBlockExercise(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json"))),
  );
  app.delete("/api/block-exercises/:id", zValidator("param", idParam), (c) =>
    c.json(removeBlockExercise(db, c.get("user").id, c.req.valid("param").id)),
  );

  // Sets
  app.post("/api/block-exercises/:id/sets", zValidator("param", idParam), zValidator("json", setsBody), (c) =>
    c.json(addSets(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json").sets), 201),
  );
  app.patch("/api/sets/:id", zValidator("param", idParam), zValidator("json", setPatch), (c) =>
    c.json(updateSet(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json"))),
  );
  app.delete("/api/sets/:id", zValidator("param", idParam), (c) => {
    deleteSet(db, c.get("user").id, c.req.valid("param").id);
    return c.body(null, 204);
  });

  // Test values
  app.get("/api/exercises/:id/tests", zValidator("param", idParam), (c) => c.json(listTests(db, c.get("user").id, c.req.valid("param").id)));
  app.post("/api/exercises/:id/tests", zValidator("param", idParam), zValidator("json", testBody), (c) =>
    c.json(createTest(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.delete("/api/tests/:id", zValidator("param", idParam), (c) => {
    deleteTest(db, c.get("user").id, c.req.valid("param").id);
    return c.body(null, 204);
  });

  // Programs: changes answer with the whole program, like sessions do.
  app.get("/api/programs", (c) => c.json(listPrograms(db, c.get("user").id)));
  app.post("/api/programs/import", zValidator("json", importBody), (c) => {
    const { file, dry_run } = c.req.valid("json");
    return c.json(importProgram(db, c.get("user").id, file, dry_run), dry_run ? 200 : 201);
  });
  app.post("/api/programs", zValidator("json", programBody), (c) => c.json(createProgram(db, c.get("user").id, c.req.valid("json")), 201));
  app.get("/api/programs/:id", zValidator("param", idParam), (c) => c.json(getProgram(db, c.get("user").id, c.req.valid("param").id)));
  app.patch("/api/programs/:id", zValidator("param", idParam), zValidator("json", programPatch), (c) =>
    c.json(updateProgram(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json"))),
  );
  app.delete("/api/programs/:id", zValidator("param", idParam), (c) => {
    deleteProgram(db, c.get("user").id, c.req.valid("param").id);
    return c.body(null, 204);
  });
  app.post("/api/programs/:id/weeks", zValidator("param", idParam), zValidator("json", weekBody), (c) =>
    c.json(addWeek(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.patch("/api/phases/:id", zValidator("param", idParam), zValidator("json", phasePatch), (c) =>
    c.json(updatePhase(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json"))),
  );
  app.delete("/api/phases/:id", zValidator("param", idParam), (c) => c.json(deletePhase(db, c.get("user").id, c.req.valid("param").id)));
  app.patch("/api/weeks/:id", zValidator("param", idParam), zValidator("json", weekPatch), (c) =>
    c.json(updateWeek(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json"))),
  );
  app.delete("/api/weeks/:id", zValidator("param", idParam), (c) => c.json(deleteWeek(db, c.get("user").id, c.req.valid("param").id)));
  app.post("/api/weeks/:id/sessions", zValidator("param", idParam), zValidator("json", z.object({ label })), (c) =>
    c.json(addPlannedSession(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json").label), 201),
  );
  app.patch("/api/planned-sessions/:id", zValidator("param", idParam), zValidator("json", plannedSessionPatch), (c) =>
    c.json(updatePlannedSession(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json"))),
  );
  app.delete("/api/planned-sessions/:id", zValidator("param", idParam), (c) =>
    c.json(deletePlannedSession(db, c.get("user").id, c.req.valid("param").id)),
  );
  app.post("/api/planned-sessions/:id/items", zValidator("param", idParam), zValidator("json", planItemBody), (c) =>
    c.json(addPlanItem(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.put("/api/planned-sessions/:id/item-order", zValidator("param", idParam), zValidator("json", z.object({ item_ids: z.array(id).max(MAX_PLAN_ITEMS) })), (c) =>
    c.json(setItemOrder(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json").item_ids)),
  );
  app.post(
    "/api/planned-sessions/:id/start",
    zValidator("param", idParam),
    zValidator("json", z.object({ started_at: isoTime.optional(), ended_at: isoTime.optional() })),
    (c) => c.json(startPlannedSession(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.patch("/api/planned-items/:id", zValidator("param", idParam), zValidator("json", planItemPatch), (c) =>
    c.json(updatePlanItem(db, c.get("user").id, c.req.valid("param").id, c.req.valid("json"))),
  );
  app.delete("/api/planned-items/:id", zValidator("param", idParam), (c) => c.json(deletePlanItem(db, c.get("user").id, c.req.valid("param").id)));

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  return app;
}
