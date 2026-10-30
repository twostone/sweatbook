import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { Db } from "./db.ts";
import { addBlock, addExerciseToBlock, addRound, deleteBlock, removeBlockExercise, setBlockOrder, updateBlockExercise } from "./data/blocks.ts";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./data/common.ts";
import { createExercise, deleteExercise, getExercise, listExercises, resolveExercise, updateExercise } from "./data/exercises.ts";
import { importProgram } from "./data/import.ts";
import { logSets } from "./data/log.ts";
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
  joinProgram,
  leaveProgram,
  listPrograms,
  setItemOrder,
  startPlannedSession,
  updatePhase,
  updatePlanItem,
  updatePlannedSession,
  updateProgram,
  updateWeek,
} from "./data/programs.ts";
import { createSession, deleteSession, exerciseHistory, findOpenSession, getSession, listSessions, updateSession } from "./data/sessions.ts";
import { addSets, deleteSet, updateSet, type SetInput } from "./data/sets.ts";
import { exerciseProgress, trainingSummary } from "./data/stats.ts";
import { createTest, deleteTest, listTests } from "./data/tests.ts";
import type { TokenScope } from "./data/tokens.ts";
import { logger } from "./log.ts";
import * as m from "./mcp-schemas.ts";
import * as v from "./mcp-views.ts";
import * as s from "./schemas.ts";

const log = logger("mcp");

const INSTRUCTIONS = [
  "Sweatbook logs strength training. Weights are in kg, distances in metres, durations in seconds, times are ISO 8601.",
  "Name exercises by their name or alias; you rarely need IDs. Start with get_today to see a running training and the next planned workout.",
  "To record sets use log_sets (it finds or starts the training). A logged set counts as done.",
  "Unknown exercise names are refused, never created: ask before calling create_exercise.",
].join(" ");

type Result = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const failed = (error: string, detail: object = {}): Result => ({ content: [{ type: "text", text: JSON.stringify({ error, ...detail }) }], isError: true });

// The same mapping as app.onError, as a tool result: the model reads the message and can correct itself.
function failure(err: unknown): Result {
  if (err instanceof NotFoundError) return failed(`${err.message} not found`);
  if (err instanceof ConflictError) return failed(err.message, err.detail);
  if (err instanceof ForbiddenError || err instanceof InvalidError) return failed(err.message);
  if (err instanceof z.ZodError) return failed(`invalid input: ${err.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ")}`);
  log.error("tool_failed", { err, stack: err instanceof Error ? err.stack : undefined });
  return failed("internal error");
}

const OK = { ok: true as const };
const asRange = (value: number | [number, number] | null | undefined) => (typeof value === "number" ? ([value, value] as [number, number]) : value);
const MAX_SETS = 20;

// "3 x" sets: expand `count`, then check against the HTTP API's own limits.
function expandSets(items: { count?: number }[] & Record<string, unknown>[]): SetInput[] {
  const sets = items.flatMap(({ count = 1, ...set }) => Array.from({ length: count }, () => set));
  if (sets.length > MAX_SETS) throw new InvalidError(`at most ${MAX_SETS} sets per call`);
  return s.setsBody.parse({ sets }).sets;
}

const programUri = (programId: string) => `sweatbook://programs/${programId}`;
const WEEKS_DEFAULT = "4";

// Every tool of the HTTP API plus evaluations, acting as `userId`. Tools that change data are only registered for a write token.
export function createMcpServer(db: Db, who: { userId: string; scope: TokenScope }, version = "0.0.0"): McpServer {
  const server = new McpServer({ name: "sweatbook", version }, { instructions: INSTRUCTIONS });
  const uid = who.userId;
  const exercise = (ref: string) => resolveExercise(db, uid, ref);

  function tool<Shape extends z.ZodRawShape, Out extends z.ZodObject<z.ZodRawShape>>(
    name: string,
    description: string,
    shape: Shape,
    output: Out,
    run: (args: z.infer<z.ZodObject<Shape>>) => z.infer<Out>,
    opts: { write?: boolean; destructive?: boolean } = {},
  ) {
    if (opts.write && who.scope !== "write") return;
    server.registerTool(
      name,
      {
        description,
        inputSchema: z.object(shape),
        outputSchema: output,
        annotations: { readOnlyHint: !opts.write, ...(opts.destructive ? { destructiveHint: true } : {}) },
      },
      // The SDK has validated and parsed the arguments against `shape`, and checks the answer against `output`.
      async (args: z.infer<z.ZodObject<Shape>>): Promise<Result> => {
        try {
          const view = run(args);
          return { content: [{ type: "text", text: JSON.stringify(view) }], structuredContent: view };
        } catch (err) {
          return failure(err);
        }
      },
    );
  }
  const write = { write: true };
  const destroy = { write: true, destructive: true };
  const list = <T extends z.ZodType>(key: string, item: T) => z.object({ [key]: z.array(item) });

  // ---- today ----
  tool("get_today", "Start here: the running training (if any) and the next planned workout of each of your programs.", {}, m.todayView, () => {
    const open = findOpenSession(db, uid);
    return {
      open_session: open && v.sessionView(open),
      next_workouts: listPrograms(db, uid)
        .filter((p) => p.joined && !p.archived && p.next)
        .map((p) => ({ program_id: p.id, program: p.name, ...p.next! })),
    };
  });

  // ---- exercise catalog (shared by all users) ----
  tool("list_exercises", "The exercise catalog, archived ones included, most recently used first.", { query: z.string().optional().describe("Only exercises whose name or alias contains this") }, list("exercises", m.exerciseView), (a) => ({
    exercises: listExercises(db, uid, a.query).map(v.exerciseView),
  }));
  tool("get_exercise", "One exercise with its set fields, note and aliases.", { exercise: m.exerciseRef }, m.exerciseView, (a) => v.exerciseView(exercise(a.exercise)));
  tool(
    "create_exercise",
    "Add an exercise to the catalog. `fields` says which values its sets have; one of reps, distance or duration is required. Names and aliases must be unique across the catalog.",
    {
      name: z.string().trim().min(1).max(80).describe("Name, unique across names and aliases"),
      fields: z.array(z.enum(["weight", "reps", "distance", "duration"])).min(1).describe("Values of a set, e.g. [\"weight\", \"reps\"]"),
      note: m.noteText(1000, "Note on the exercise").optional(),
      aliases: z.array(z.string().trim().min(1).max(80)).max(10).optional().describe("Other names for searching and logging"),
    },
    m.exerciseView,
    (a) => v.exerciseView(createExercise(db, uid, s.exerciseBody.parse(a))),
    write,
  );
  tool(
    "update_exercise",
    "Change an exercise for all users. `aliases` replaces the list; `archived` hides it from new trainings. A field can only be removed while no set has a value in it.",
    {
      exercise: m.exerciseRef,
      name: z.string().trim().min(1).max(80).optional().describe("New name"),
      fields: z.array(z.enum(["weight", "reps", "distance", "duration"])).min(1).optional().describe("New set fields"),
      note: m.noteText(1000, "Note on the exercise").optional(),
      aliases: z.array(z.string().trim().min(1).max(80)).max(10).optional().describe("Replaces all aliases"),
      archived: z.boolean().optional().describe("true hides it from new trainings, false takes it back"),
    },
    m.exerciseView,
    ({ exercise: ref, ...patch }) => v.exerciseView(updateExercise(db, uid, exercise(ref).id, s.exercisePatch.parse(patch))),
    write,
  );
  tool("delete_exercise", "Delete an exercise that was never used; otherwise archive it with update_exercise.", { exercise: m.exerciseRef }, m.okView, (a) => {
    deleteExercise(db, uid, exercise(a.exercise).id);
    return OK;
  }, destroy);

  // ---- history, evaluations, test values ----
  tool(
    "get_exercise_history",
    "The sets of an exercise per training, newest first.",
    { exercise: m.exerciseRef, before: m.pageBefore, limit: m.pageLimit },
    m.historyView,
    ({ exercise: ref, ...page }) => v.historyView(exerciseHistory(db, uid, exercise(ref).id, s.page.parse(page))),
  );
  tool(
    "get_exercise_progress",
    "How an exercise developed: per training the volume, the top set and the estimated 1RM, newest first.",
    { exercise: m.exerciseRef, weeks: m.weeks },
    m.progressView,
    (a) => exerciseProgress(db, uid, exercise(a.exercise).id, { weeks: a.weeks }),
  );
  tool("get_training_summary", "Per calendar week (oldest first, empty weeks included): trainings, sets, volume and the same per exercise.", { weeks: m.weeks }, m.summaryView, (a) =>
    trainingSummary(db, uid, { weeks: a.weeks }),
  );
  tool("list_tests", "Test values (1RM or best performance) of an exercise, newest first.", { exercise: m.exerciseRef }, list("tests", m.testView), (a) => ({
    tests: listTests(db, uid, exercise(a.exercise).id).map((t) => v.testView({ ...t, exercise_name: undefined })),
  }));
  tool(
    "create_test",
    "Record a test value. A one_rm needs weight_kg; a best needs reps, distance_m or duration_s. A 1RM drives the %-weights of plans.",
    {
      exercise: m.exerciseRef,
      kind: z.enum(["one_rm", "best"]).describe("one_rm = one-rep max, best = best performance"),
      tested_on: m.isoDay.optional().describe("Date of the test, default today"),
      weight_kg: z.number().min(0).max(1000).nullable().optional().describe("Weight in kg"),
      reps: z.number().int().min(0).max(1000).nullable().optional().describe("Repetitions"),
      distance_m: z.number().int().min(0).max(1_000_000).nullable().optional().describe("Distance in metres"),
      duration_s: z.number().int().min(0).max(86400).nullable().optional().describe("Duration in seconds"),
      note: m.noteText(500, "Note").optional(),
    },
    m.testView,
    ({ exercise: ref, ...body }) => v.testView(createTest(db, uid, exercise(ref).id, s.testBody.parse(body))),
    write,
  );
  tool("delete_test", "Delete a test value.", { test_id: m.uuid("test value") }, m.okView, (a) => {
    deleteTest(db, uid, a.test_id);
    return OK;
  }, destroy);

  // ---- trainings (sessions) ----
  tool("list_sessions", "Trainings, newest first. Page back with `before`.", { before: m.pageBefore, limit: m.pageLimit }, list("sessions", m.sessionListItem), (a) => ({
    sessions: listSessions(db, uid, s.page.parse(a)).map(v.sessionListItem),
  }));
  tool("get_session", "A whole training: exercises with their sets, plan target and the last time.", { session_id: m.uuid("training") }, m.sessionView, (a) =>
    v.sessionView(getSession(db, uid, a.session_id)),
  );
  const sessionFields = {
    title: m.noteText(100, "Title").optional(),
    started_at: m.isoTime.optional().describe("Start; default now"),
    note: m.noteText(1000, "Note on the training").optional(),
  };
  tool(
    "create_session",
    "Start a training; this ends a running one. With ended_at it is a past training entered afterwards, which leaves the running one alone.",
    { ...sessionFields, ended_at: m.isoTime.optional().describe("End; only for a training entered afterwards") },
    m.sessionView,
    (a) => v.sessionView(createSession(db, uid, s.sessionBody.parse(a))),
    write,
  );
  tool(
    "update_session",
    "Change a training. ended_at ends it, null reopens it (which ends another running one).",
    { session_id: m.uuid("training"), ...sessionFields, ended_at: m.isoTime.nullable().optional().describe("End of the training; null reopens it") },
    m.sessionView,
    ({ session_id, ...patch }) => v.sessionView(updateSession(db, uid, session_id, s.sessionPatch.parse(patch))),
    write,
  );
  tool("delete_session", "Delete a training with all its sets.", { session_id: m.uuid("training") }, m.okView, (a) => {
    deleteSession(db, uid, a.session_id);
    return OK;
  }, destroy);

  // ---- logging ----
  tool(
    "log_sets",
    "Log sets for an exercise by name. They go into the given training, else the running one, else a new one is started. Use `count` for repeats: {count: 3, reps: 5, weight_kg: 100}. Answers with the whole training.",
    { exercise: m.exerciseRef, sets: m.setList, session_id: m.uuid("training").optional().describe("Default: the running training") },
    m.sessionView,
    (a) => v.sessionView(logSets(db, uid, { exercise: a.exercise, sets: expandSets(a.sets), session_id: a.session_id })),
    write,
  );
  tool("add_block", "Add an exercise to a training as a new block (log_sets does this for you).", { session_id: m.uuid("training"), exercise: m.exerciseRef }, m.sessionView, (a) =>
    v.sessionView(addBlock(db, uid, a.session_id, exercise(a.exercise).id)), write);
  tool("set_block_order", "Reorder the blocks of a training; every block_id exactly once.", { session_id: m.uuid("training"), block_ids: z.array(m.uuid("block")).max(100).describe("Every block ID of the training, in the new order") }, m.sessionView, (a) =>
    v.sessionView(setBlockOrder(db, uid, a.session_id, a.block_ids)), write);
  tool("add_exercise_to_block", "Add another exercise to a block, which makes it a superset.", { block_id: m.uuid("block"), exercise: m.exerciseRef }, m.sessionView, (a) =>
    v.sessionView(addExerciseToBlock(db, uid, a.block_id, exercise(a.exercise).id)), write);
  tool(
    "add_round",
    "Add one set per exercise of a superset block, all or nothing.",
    { block_id: m.uuid("block"), sets: z.array(m.roundSet).min(1).max(10).describe("One set per exercise of the block") },
    m.sessionView,
    (a) => v.sessionView(addRound(db, uid, a.block_id, s.roundBody.parse({ sets: a.sets }).sets)),
    write,
  );
  tool("delete_block", "Remove a block with its sets.", { block_id: m.uuid("block") }, m.sessionView, (a) => v.sessionView(deleteBlock(db, uid, a.block_id)), destroy);
  tool(
    "update_block_exercise",
    "Set the note of an exercise within this training only.",
    { block_exercise_id: m.uuid("exercise within the block"), note: m.noteText(1000, "Note") },
    m.sessionView,
    (a) => v.sessionView(updateBlockExercise(db, uid, a.block_exercise_id, s.blockExercisePatch.parse({ note: a.note }))),
    write,
  );
  tool("remove_block_exercise", "Remove an exercise from its block (the last one takes the block with it).", { block_exercise_id: m.uuid("exercise within the block") }, m.sessionView, (a) =>
    v.sessionView(removeBlockExercise(db, uid, a.block_exercise_id)), destroy);
  tool(
    "add_sets",
    "Add sets to an exercise within a training by its block_exercise_id (see get_session). Prefer log_sets when you only know the exercise name.",
    { block_exercise_id: m.uuid("exercise within the block"), sets: m.setList },
    list("sets", m.setView),
    (a) => ({ sets: addSets(db, uid, a.block_exercise_id, expandSets(a.sets)).map(v.setView) }),
    write,
  );
  tool("update_set", "Change a set; leave out what stays.", { set_id: m.uuid("set"), ...m.singleSet.shape }, m.setView, ({ set_id, ...patch }) =>
    v.setView(updateSet(db, uid, set_id, s.setPatch.parse(patch))), write);
  tool("delete_set", "Delete a set.", { set_id: m.uuid("set") }, m.okView, (a) => {
    deleteSet(db, uid, a.set_id);
    return OK;
  }, destroy);

  // ---- programs ----
  tool("list_programs", "Your programs (own and joined) with progress and the next workout, then shared ones you have not joined.", {}, list("programs", m.programListItem), () => ({
    programs: listPrograms(db, uid).map(v.programListItem),
  }));
  tool("get_program", "A whole program: sections, weeks, planned sessions and rows with calculated weights, plus test values.", { program_id: m.uuid("program") }, m.programView, (a) =>
    v.programView(getProgram(db, uid, a.program_id)));
  tool(
    "import_program",
    "Create a whole program from a plan file (the format of examples/programm-beispiel.json), all or nothing. dry_run only checks and reports what would be created.",
    { dry_run: z.boolean().optional().describe("Only check and report, create nothing"), file: s.importBody.shape.file.describe("The plan file as JSON: program, exercises, tests, weeks") },
    m.importView,
    (a) => {
      const result = importProgram(db, uid, a.file, a.dry_run);
      const p = result.program;
      return {
        dry_run: a.dry_run === true,
        program: { ...v.programListItem(p), weeks: p.weeks.length, planned_sessions: p.weeks.reduce((n, w) => n + w.sessions.length, 0) },
        new_exercises: result.new_exercises,
      };
    },
    write,
  );
  tool("create_program", "Create an empty program.", { name: z.string().trim().min(1).max(80).describe("Name of the program"), start_date: m.isoDay.describe("Monday of week 1") }, m.programView, (a) =>
    v.programView(createProgram(db, uid, s.programBody.parse(a))), write);
  tool(
    "update_program",
    "Rename (owner only), share with all users (owner only), set your own start date or archive a program for yourself.",
    {
      program_id: m.uuid("program"),
      name: z.string().trim().min(1).max(80).optional().describe("New name (owner only)"),
      shared: z.boolean().optional().describe("Visible to all users, who can join (owner only)"),
      start_date: m.isoDay.optional().describe("Your own Monday of week 1"),
      archived: z.boolean().optional().describe("Archive for yourself"),
    },
    m.programView,
    ({ program_id, ...patch }) => v.programView(updateProgram(db, uid, program_id, s.programPatch.parse(patch))),
    write,
  );
  tool("join_program", "Join a program shared by somebody else, with your own start date.", { program_id: m.uuid("program"), start_date: m.isoDay.describe("Your Monday of week 1") }, m.programView, (a) =>
    v.programView(joinProgram(db, uid, a.program_id, a.start_date)), write);
  tool("leave_program", "Leave a joined program (not the owner).", { program_id: m.uuid("program") }, m.okView, (a) => {
    leaveProgram(db, uid, a.program_id);
    return OK;
  }, destroy);
  tool("delete_program", "Delete a program (owner only).", { program_id: m.uuid("program") }, m.okView, (a) => {
    deleteProgram(db, uid, a.program_id);
    return OK;
  }, destroy);
  tool(
    "add_week",
    "Append a week to a program. `phase` is the section name (found or created); copy_of copies another week.",
    { program_id: m.uuid("program"), phase: m.noteText(100, "Section name").optional(), deload: z.boolean().optional().describe("Mark as deload week (display only)"), copy_of: m.uuid("week to copy").optional() },
    m.programView,
    ({ program_id, ...body }) => v.programView(addWeek(db, uid, program_id, s.weekBody.parse(body))),
    write,
  );
  tool(
    "update_week",
    "Change the section or deload flag of a week.",
    { week_id: m.uuid("week"), phase: m.noteText(100, "Section name").optional(), deload: z.boolean().optional().describe("Deload week (display only)") },
    m.programView,
    ({ week_id, ...patch }) => v.programView(updateWeek(db, uid, week_id, s.weekPatch.parse(patch))),
    write,
  );
  tool("delete_week", "Delete a week.", { week_id: m.uuid("week") }, m.programView, (a) => v.programView(deleteWeek(db, uid, a.week_id)), destroy);
  tool(
    "update_phase",
    "Rename a section (all its weeks) or set its note.",
    { phase_id: m.uuid("section"), name: z.string().trim().min(1).max(100).optional().describe("New name of the section"), note: m.noteText(1000, "Note").optional() },
    m.programView,
    ({ phase_id, ...patch }) => v.programView(updatePhase(db, uid, phase_id, s.phasePatch.parse(patch))),
    write,
  );
  tool("delete_phase", "Dissolve a section; its weeks stay without one.", { phase_id: m.uuid("section") }, m.programView, (a) => v.programView(deletePhase(db, uid, a.phase_id)), destroy);
  tool("add_planned_session", "Add a planned session (e.g. \"A\") to a week.", { week_id: m.uuid("week"), label: z.string().trim().min(1).max(20).describe("Short label, e.g. A") }, m.programView, (a) =>
    v.programView(addPlannedSession(db, uid, a.week_id, a.label)), write);
  tool(
    "update_planned_session",
    "Rename a planned session or skip it (skipped: true, optional skip_note); skipped: false takes it back.",
    { planned_session_id: m.uuid("planned session"), label: z.string().trim().min(1).max(20).optional().describe("New label"), skipped: z.boolean().optional().describe("true skips, false takes the skip back"), skip_note: m.noteText(100, "Why it was skipped").optional() },
    m.programView,
    ({ planned_session_id, ...patch }) => v.programView(updatePlannedSession(db, uid, planned_session_id, s.plannedSessionPatch.parse(patch))),
    write,
  );
  tool("delete_planned_session", "Delete a planned session.", { planned_session_id: m.uuid("planned session") }, m.programView, (a) =>
    v.programView(deletePlannedSession(db, uid, a.planned_session_id)), destroy);

  // Exercise names in a plan line become IDs, a single number a range, then the HTTP API's own shapes apply.
  const planLine = (a: z.infer<z.ZodObject<typeof m.planItemFields>>) => {
    const { exercise: ex, load_ref_exercise: ref, ...rest } = a;
    return {
      ...rest,
      ...("sets" in a ? { sets: asRange(a.sets) } : {}),
      ...("reps" in a ? { reps: asRange(a.reps) } : {}),
      ...("distance_m" in a ? { distance_m: asRange(a.distance_m) } : {}),
      ...("duration_s" in a ? { duration_s: asRange(a.duration_s) } : {}),
      ...(ex !== undefined ? { exercise_id: ex === null ? null : exercise(ex).id } : {}),
      ...(ref !== undefined ? { load_ref_exercise_id: ref === null ? null : exercise(ref).id } : {}),
    };
  };
  tool(
    "add_plan_item",
    "Add a line to a planned session: an exercise with targets (sets, reps/distance/duration, a load in kg or as percent of a 1RM), or a note line without exercise.",
    { planned_session_id: m.uuid("planned session"), ...m.planItemFields },
    m.programView,
    ({ planned_session_id, ...line }) => v.programView(addPlanItem(db, uid, planned_session_id, s.planItemBody.parse(planLine(line)))),
    write,
  );
  tool(
    "update_plan_item",
    "Change a plan line; leave out what stays.",
    { planned_item_id: m.uuid("plan line"), ...m.planItemFields },
    m.programView,
    ({ planned_item_id, ...line }) => v.programView(updatePlanItem(db, uid, planned_item_id, s.planItemPatch.parse(planLine(line)))),
    write,
  );
  tool("delete_plan_item", "Delete a plan line.", { planned_item_id: m.uuid("plan line") }, m.programView, (a) => v.programView(deletePlanItem(db, uid, a.planned_item_id)), destroy);
  tool(
    "set_plan_item_order",
    "Reorder the lines of a planned session; every line ID exactly once.",
    { planned_session_id: m.uuid("planned session"), item_ids: z.array(m.uuid("plan line")).max(s.MAX_PLAN_ITEMS).describe("Every line ID of the session, in the new order") },
    m.programView,
    (a) => v.programView(setItemOrder(db, uid, a.planned_session_id, a.item_ids)),
    write,
  );
  tool(
    "start_planned_session",
    "Start a training from a planned session; its exercises are ready to log. started_at/ended_at only to enter one afterwards.",
    { planned_session_id: m.uuid("planned session"), started_at: m.isoTime.optional(), ended_at: m.isoTime.optional() },
    m.sessionView,
    ({ planned_session_id, ...times }) => v.sessionView(startPlannedSession(db, uid, planned_session_id, s.plannedSessionStart.parse(times))),
    write,
  );

  // ---- resources: programs as context a client can attach ----
  // Only programs the user has joined: a shared one not joined yet is not readable (404), like in the app.
  server.registerResource(
    "program",
    new ResourceTemplate("sweatbook://programs/{programId}", {
      list: () => ({
        resources: listPrograms(db, uid)
          .filter((p) => p.joined)
          .map((p) => ({ uri: programUri(p.id), name: p.name, description: `${p.done}/${p.total} Einheiten erledigt`, mimeType: "application/json" })),
      }),
    }),
    { title: "Training program", description: "A whole program: sections, weeks, planned sessions and rows with calculated weights.", mimeType: "application/json" },
    (uri, variables) => {
      // Not a tool result, so an error here is thrown and reaches the client as a protocol error.
      const programId = s.id.safeParse(variables.programId);
      if (!programId.success) throw new InvalidError("invalid program id");
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(v.programView(getProgram(db, uid, programId.data))) }] };
    },
  );

  // ---- prompts: ready-made jobs for the tools above; they carry instructions, never data ----
  const prompt = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });
  server.registerPrompt(
    "analyze_training",
    {
      title: "Analyze my training",
      description: "Review the last weeks: volume, progress per exercise, gaps.",
      argsSchema: z.object({ weeks: z.string().optional().describe(`Number of weeks, default ${WEEKS_DEFAULT}`) }),
    },
    ({ weeks }) => {
      const n = Number.parseInt(weeks ?? "", 10);
      return prompt(
        `Analyze my training of the last ${Number.isInteger(n) && n > 0 ? Math.min(n, 52) : WEEKS_DEFAULT} weeks. ` +
          "Call get_training_summary first, then get_exercise_progress for the three or four most trained exercises. " +
          "Report training frequency, volume trend, progress (estimated 1RM and top sets) and gaps or imbalances, then give two or three concrete suggestions. " +
          "Answer in my language and keep it short. Do not change any data.",
      );
    },
  );
  server.registerPrompt(
    "suggest_next_workout",
    { title: "Suggest my next workout", description: "Weights and reps for the next planned workout, based on recent sessions." },
    () =>
      prompt(
        "Suggest what I should do in my next workout. Call get_today to see the running training and the next planned workout, " +
          "then get_program for that program and get_exercise_history for its exercises. " +
          "For every exercise give weight and reps with a one-line reason (last time, plan target). " +
          "Only suggest; do not log or change anything. Answer in my language.",
      ),
  );
  server.registerPrompt(
    "adjust_plan",
    {
      title: "Adjust a training plan",
      description: "Propose changes to a program and apply them after confirmation (needs a write token).",
      argsSchema: z.object({
        request: z.string().describe("What should change, e.g. 'make week 3 lighter'"),
        program_id: z.string().optional().describe("ID of the program; default: ask via list_programs"),
      }),
    },
    ({ request, program_id }) =>
      prompt(
        `Adjust my training plan: ${request}\n` +
          (program_id ? `Program ID: ${program_id}. ` : "Use list_programs to find the program and ask me if it is unclear. ") +
          "Read it with get_program, propose the exact changes as a short list, and apply them with the plan tools only after I confirm. " +
          "Applying changes needs a write token; if the plan tools are missing, say so. Answer in my language.",
      ),
  );

  return server;
}
