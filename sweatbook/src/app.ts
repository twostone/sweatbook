import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { zValidator } from "@hono/zod-validator";
import * as z from "zod";
import type { Db } from "./db.ts";
import { addBlock, addExerciseToBlock, addRound, deleteBlock, removeBlockExercise, setBlockOrder, updateBlockExercise } from "./data/blocks.ts";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./data/common.ts";
import {
  addPlanItem,
  addPlannedSession,
  addWeek,
  createProgram,
  deletePhase,
  deletePlanItem,
  deletePlannedSession,
  deleteProgram,
  joinProgram,
  leaveProgram,
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
} from "./data/programs.ts";
import { importProgram } from "./data/import.ts";
import { createTest, deleteTest, listTests } from "./data/tests.ts";
import { createExercise, deleteExercise, getExercise, listExercises, updateExercise } from "./data/exercises.ts";
import { createSession, deleteSession, exerciseHistory, getSession, listSessions, updateSession } from "./data/sessions.ts";
import { addSets, deleteSet, updateSet } from "./data/sets.ts";
import { resolveUser, type User } from "./data/users.ts";
import { createToken, listTokens, revokeToken } from "./data/tokens.ts";
import { createFailureLimiter, handleMcp } from "./mcp-http.ts";
import { logger } from "./log.ts";
import {
  isoTime,
  id,
  idParam,
  exerciseBody,
  exercisePatch,
  setsBody,
  setPatch,
  roundBody,
  sessionBody,
  sessionPatch,
  page,
  exerciseRef,
  blockExercisePatch,
  planItemPatch,
  planItemBody,
  day,
  joinBody,
  programBody,
  programPatch,
  weekBody,
  weekPatch,
  phasePatch,
  label,
  plannedSessionPatch,
  MAX_PLAN_ITEMS,
  testBody,
  tokenBody,
  importBody,
} from "./schemas.ts";


export type AppOptions = {
  // If set, only connections from this IP are served. HA ingress always connects from 172.30.32.2 (Supervisor);
  // everything else on the network must be refused, otherwise the X-Remote-User-* headers could be forged.
  allowedIp?: string;
  // /mcp is only served when switched on (the app option mcp_enabled); off -> 404.
  mcpEnabled?: boolean;
  version?: string;
};

type Env = { Variables: { user: User } };

const log = logger("app");
const MCP_PATH = "/mcp";
// A request is only logged when it failed or took this long.
const SLOW_REQUEST_MS = 2000;

export function createApp(db: Db, opts: AppOptions = {}) {
  const app = new Hono<Env>();
  const mcpLimiter = createFailureLimiter();

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
      // The one route outside the guard: external MCP clients cannot come through ingress. It authenticates by token itself.
      if (c.req.path === MCP_PATH) return next();
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
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
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

  // MCP access tokens: managed in the app (ingress), used on /mcp. The plain token is shown once, at creation.
  app.get("/api/tokens", (c) => c.json(listTokens(db, c.get("user").id)));
  app.post("/api/tokens", zValidator("json", tokenBody), (c) => c.json(createToken(db, c.get("user").id, c.req.valid("json")), 201));
  app.delete("/api/tokens/:id", zValidator("param", idParam), (c) => {
    revokeToken(db, c.get("user").id, c.req.valid("param").id);
    return c.body(null, 204);
  });

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
  app.post("/api/programs/:id/join", zValidator("param", idParam), zValidator("json", joinBody), (c) => {
    const body = c.req.valid("json");
    return c.json(joinProgram(db, c.get("user").id, c.req.valid("param").id, body.start_date, body.start_planned_session_id));
  });
  app.delete("/api/programs/:id/membership", zValidator("param", idParam), (c) => {
    leaveProgram(db, c.get("user").id, c.req.valid("param").id);
    return c.body(null, 204);
  });
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
  app.all(MCP_PATH, (c) => (opts.mcpEnabled ? handleMcp(c, db, mcpLimiter, opts.version) : c.json({ error: "not found" }, 404)));

  return app;
}
