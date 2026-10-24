import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { zValidator } from "@hono/zod-validator";
import * as z from "zod";
import type { Db } from "./db.ts";
import { addBlock, addExerciseToBlock, addRound, deleteBlock, removeBlockExercise, setBlockOrder } from "./data/blocks.ts";
import { ConflictError, InvalidError, NotFoundError } from "./data/common.ts";
import { createExercise, deleteExercise, getExercise, listExercises, METRICS, updateExercise } from "./data/exercises.ts";
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
const exerciseBody = z.object({
  name,
  metrics: z.enum(METRICS),
  note: optionalText(1000),
  aliases: z.array(name).max(MAX_ALIASES).optional(),
});
const exercisePatch = z.object({
  name: name.optional(),
  metrics: z.enum(METRICS).optional(),
  note: optionalText(1000),
  aliases: z.array(name).max(MAX_ALIASES).optional(),
  archived: z.boolean().optional(),
});

// weight_kg null = bodyweight. Which fields a set needs depends on the exercise and is checked in data/sets.ts.
const setFields = {
  weight_kg: z.number().min(0).max(1000).nullable().optional(),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  duration_s: z.number().int().min(0).max(86400).nullable().optional(),
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

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  return app;
}
