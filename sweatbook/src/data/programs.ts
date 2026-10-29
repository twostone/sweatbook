import { isoNow, transaction, type Db } from "../db.ts";
import { InvalidError, newId, nextPosition, NotFoundError, toBool } from "./common.ts";
import { insertBlock } from "./blocks.ts";
import { assertUsable, getExercise } from "./exercises.ts";
import { ITEM_COLUMNS, PlanContext, planItem, type PlanItem, type PlanItemRow, type Range } from "./plan.ts";
import { getSession, insertSession, type SessionTree } from "./sessions.ts";
import { TEST_COLUMNS, type ExerciseTest, type TestKind } from "./tests.ts";

// A program is a multi-week plan: weeks (with a phase name and a deload flag) hold planned sessions ("A", "B"), which
// hold plan lines. Done is not stored: a planned session is done when a session with sets hangs on it, or skipped.
export type PlannedSessionState = "done" | "skipped" | "open";

export type PlannedSessionTree = {
  id: string;
  position: number;
  label: string;
  state: PlannedSessionState;
  skip_note: string | null;
  session_id: string | null; // the newest session started from it
  items: PlanItem[];
};
export type WeekTree = { id: string; number: number; phase: string | null; deload: boolean; sessions: PlannedSessionTree[] };
export type NextWorkout = { planned_session_id: string; week: number; phase: string | null; label: string };

export type ProgramSummary = {
  id: string;
  name: string;
  start_date: string; // YYYY-MM-DD, the Monday of week 1
  archived: boolean;
  done: number; // planned sessions done or skipped
  total: number;
  next: NextWorkout | null; // the first open planned session in order
};
export type ProgramTree = ProgramSummary & { weeks: WeekTree[]; tests: (ExerciseTest & { exercise_name: string })[] };

type ProgramRow = { id: string; name: string; start_date: string; archived: number };

function programRow(db: Db, userId: string, id: string): ProgramRow {
  const row = db.prepare("SELECT id, name, start_date, archived FROM program WHERE id = ? AND user_id = ?").get(id, userId) as ProgramRow | undefined;
  if (!row) throw new NotFoundError("program");
  return row;
}

// The program a week / planned session / plan line belongs to; foreign or unknown ids are the same 404.
function ownerOf(db: Db, userId: string, what: "week" | "planned session" | "plan line", id: string): string {
  const sql = {
    week: "SELECT p.id FROM program_week w JOIN program p ON p.id = w.program_id WHERE w.id = ? AND p.user_id = ?",
    "planned session":
      "SELECT p.id FROM planned_session ps JOIN program_week w ON w.id = ps.week_id JOIN program p ON p.id = w.program_id WHERE ps.id = ? AND p.user_id = ?",
    "plan line":
      `SELECT p.id FROM planned_item pi JOIN planned_session ps ON ps.id = pi.planned_session_id
       JOIN program_week w ON w.id = ps.week_id JOIN program p ON p.id = w.program_id WHERE pi.id = ? AND p.user_id = ?`,
  }[what];
  const row = db.prepare(sql).get(id, userId) as { id: string } | undefined;
  if (!row) throw new NotFoundError(what);
  return row.id;
}

type SessionRow = {
  id: string;
  week_id: string;
  week: number;
  phase: string | null;
  position: number;
  label: string;
  skipped_at: string | null;
  skip_note: string | null;
  session_id: string | null;
  done_at: string | null;
};

const WITH_SETS = `EXISTS (SELECT 1 FROM block b JOIN block_exercise be ON be.block_id = b.id JOIN set_log l ON l.block_exercise_id = be.id WHERE b.session_id = s.id)`;

// All planned sessions of a program in training order, with what hangs on them. done_at: when the first session with
// sets started (the day whose 1RM counts for the weights).
function sessionRows(db: Db, programId: string): SessionRow[] {
  return db
    .prepare(
      `SELECT ps.id, ps.week_id, w.number AS week, w.phase, ps.position, ps.label, ps.skipped_at, ps.skip_note,
         (SELECT s.id FROM session s WHERE s.planned_session_id = ps.id ORDER BY s.started_at DESC LIMIT 1) AS session_id,
         (SELECT s.started_at FROM session s WHERE s.planned_session_id = ps.id AND ${WITH_SETS} ORDER BY s.started_at LIMIT 1) AS done_at
       FROM planned_session ps JOIN program_week w ON w.id = ps.week_id
       WHERE w.program_id = ? ORDER BY w.number, ps.position`,
    )
    .all(programId) as SessionRow[];
}

const stateOf = (row: SessionRow): PlannedSessionState => (row.done_at !== null ? "done" : row.skipped_at !== null ? "skipped" : "open");

function summarize(program: ProgramRow, rows: SessionRow[]): ProgramSummary {
  const open = rows.filter((r) => stateOf(r) === "open");
  const first = open[0];
  return {
    id: program.id,
    name: program.name,
    start_date: program.start_date,
    archived: toBool(program.archived),
    done: rows.length - open.length,
    total: rows.length,
    next: first ? { planned_session_id: first.id, week: first.week, phase: first.phase, label: first.label } : null,
  };
}

// Active programs first (newest first), then archived ones.
export function listPrograms(db: Db, userId: string): ProgramSummary[] {
  const programs = db
    .prepare("SELECT id, name, start_date, archived FROM program WHERE user_id = ? ORDER BY archived, created_at DESC, id")
    .all(userId) as ProgramRow[];
  return programs.map((p) => summarize(p, sessionRows(db, p.id)));
}

// The whole program in one answer, with computed weights and the test values that matter to it.
export function getProgram(db: Db, userId: string, id: string): ProgramTree {
  const program = programRow(db, userId, id);
  const rows = sessionRows(db, id);
  const ctx = new PlanContext(db, userId);
  const itemsOf = db.prepare(`SELECT ${ITEM_COLUMNS} FROM planned_item WHERE planned_session_id = ? ORDER BY position`);
  const weeks = (db.prepare("SELECT id, number, phase, deload FROM program_week WHERE program_id = ? ORDER BY number").all(id) as {
    id: string;
    number: number;
    phase: string | null;
    deload: number;
  }[]).map(
    (w): WeekTree => ({
      id: w.id,
      number: w.number,
      phase: w.phase,
      deload: toBool(w.deload),
      sessions: rows
        .filter((r) => r.week_id === w.id)
        .map((r) => ({
          id: r.id,
          position: r.position,
          label: r.label,
          state: stateOf(r),
          skip_note: r.skip_note,
          session_id: r.session_id,
          items: (itemsOf.all(r.id) as PlanItemRow[]).map((item) => planItem(ctx, item, r.done_at?.slice(0, 10) ?? null)),
        })),
    }),
  );
  const tests = db
    .prepare(
      `SELECT ${TEST_COLUMNS}, e.name AS exercise_name FROM exercise_test t JOIN exercise e ON e.id = t.exercise_id
       WHERE t.exercise_id IN (
         SELECT pi.exercise_id FROM planned_item pi JOIN planned_session ps ON ps.id = pi.planned_session_id
           JOIN program_week w ON w.id = ps.week_id WHERE w.program_id = ? AND pi.test_kind IS NOT NULL
         UNION
         SELECT pi.load_ref_exercise_id FROM planned_item pi JOIN planned_session ps ON ps.id = pi.planned_session_id
           JOIN program_week w ON w.id = ps.week_id WHERE w.program_id = ? AND pi.load_ref_exercise_id IS NOT NULL)
       ORDER BY t.tested_on, e.name`,
    )
    .all(id, id) as (ExerciseTest & { exercise_name: string })[];
  return { ...summarize(program, rows), weeks, tests };
}

export type ProgramInput = { name: string; start_date: string };
export type ProgramPatch = { name?: string; start_date?: string; archived?: boolean };

export function createProgram(db: Db, userId: string, input: ProgramInput): ProgramTree {
  const id = newId();
  db.prepare("INSERT INTO program (id, user_id, name, start_date, archived, created_at) VALUES (?, ?, ?, ?, 0, ?)").run(
    id,
    userId,
    input.name,
    input.start_date,
    isoNow(),
  );
  return getProgram(db, userId, id);
}

export function updateProgram(db: Db, userId: string, id: string, patch: ProgramPatch): ProgramTree {
  const current = programRow(db, userId, id);
  db.prepare("UPDATE program SET name = ?, start_date = ?, archived = ? WHERE id = ?").run(
    patch.name ?? current.name,
    patch.start_date ?? current.start_date,
    (patch.archived ?? toBool(current.archived)) ? 1 : 0,
    id,
  );
  return getProgram(db, userId, id);
}

// Sessions started from the program stay; they only lose the link.
export function deleteProgram(db: Db, userId: string, id: string): void {
  programRow(db, userId, id);
  db.prepare("DELETE FROM program WHERE id = ?").run(id);
}

// Weeks

const nextWeekNumber = (db: Db, programId: string): number =>
  ((db.prepare("SELECT MAX(number) AS n FROM program_week WHERE program_id = ?").get(programId) as { n: number | null }).n ?? 0) + 1;

export function insertPlannedSession(db: Db, weekId: string, label: string): string {
  const id = newId();
  db.prepare("INSERT INTO planned_session (id, week_id, position, label) VALUES (?, ?, ?, ?)").run(
    id,
    weekId,
    nextPosition(db, "planned_session", "week_id", weekId),
    label,
  );
  return id;
}

// The new week gets the next number. A copy takes phase, deload flag, planned sessions and lines of another week of the
// same program ("Woche kopieren": most weeks differ only in percent or sets).
export function addWeek(db: Db, userId: string, programId: string, opts: { phase?: string | null; deload?: boolean; copy_of?: string }): ProgramTree {
  programRow(db, userId, programId);
  transaction(db, () => {
    let source: { id: string; phase: string | null; deload: number } | undefined;
    if (opts.copy_of) {
      source = db.prepare("SELECT id, phase, deload FROM program_week WHERE id = ? AND program_id = ?").get(opts.copy_of, programId) as typeof source;
      if (!source) throw new NotFoundError("week");
    }
    const weekId = newId();
    db.prepare("INSERT INTO program_week (id, program_id, number, phase, deload) VALUES (?, ?, ?, ?, ?)").run(
      weekId,
      programId,
      nextWeekNumber(db, programId),
      opts.phase !== undefined ? opts.phase : (source?.phase ?? null),
      (opts.deload ?? (source ? toBool(source.deload) : false)) ? 1 : 0,
    );
    if (source) copySessions(db, source.id, weekId);
  });
  return getProgram(db, userId, programId);
}

function copySessions(db: Db, fromWeekId: string, toWeekId: string): void {
  const sessions = db.prepare("SELECT id, label FROM planned_session WHERE week_id = ? ORDER BY position").all(fromWeekId) as { id: string; label: string }[];
  const items = db.prepare(`SELECT ${ITEM_COLUMNS} FROM planned_item WHERE planned_session_id = ? ORDER BY position`);
  for (const session of sessions) {
    const copyId = insertPlannedSession(db, toWeekId, session.label);
    for (const item of items.all(session.id) as PlanItemRow[]) writeItem(db, copyId, null, rowToInput(item));
  }
}

export function updateWeek(db: Db, userId: string, weekId: string, patch: { phase?: string | null; deload?: boolean }): ProgramTree {
  const programId = ownerOf(db, userId, "week", weekId);
  const current = db.prepare("SELECT phase, deload FROM program_week WHERE id = ?").get(weekId) as { phase: string | null; deload: number };
  db.prepare("UPDATE program_week SET phase = ?, deload = ? WHERE id = ?").run(
    patch.phase !== undefined ? patch.phase : current.phase,
    (patch.deload ?? toBool(current.deload)) ? 1 : 0,
    weekId,
  );
  return getProgram(db, userId, programId);
}

export function deleteWeek(db: Db, userId: string, weekId: string): ProgramTree {
  const programId = ownerOf(db, userId, "week", weekId);
  db.prepare("DELETE FROM program_week WHERE id = ?").run(weekId);
  return getProgram(db, userId, programId);
}

// Planned sessions

export function addPlannedSession(db: Db, userId: string, weekId: string, label: string): ProgramTree {
  const programId = ownerOf(db, userId, "week", weekId);
  insertPlannedSession(db, weekId, label);
  return getProgram(db, userId, programId);
}

// skipped: true skips it (skip_note says why, e.g. "vor der App"), false takes the skip back.
export function updatePlannedSession(
  db: Db,
  userId: string,
  id: string,
  patch: { label?: string; skipped?: boolean; skip_note?: string | null },
): ProgramTree {
  const programId = ownerOf(db, userId, "planned session", id);
  const current = db.prepare("SELECT label, skipped_at, skip_note FROM planned_session WHERE id = ?").get(id) as {
    label: string;
    skipped_at: string | null;
    skip_note: string | null;
  };
  const skipped = patch.skipped ?? current.skipped_at !== null;
  db.prepare("UPDATE planned_session SET label = ?, skipped_at = ?, skip_note = ? WHERE id = ?").run(
    patch.label ?? current.label,
    skipped ? (current.skipped_at ?? isoNow()) : null,
    skipped ? (patch.skip_note !== undefined ? patch.skip_note : current.skip_note) : null,
    id,
  );
  return getProgram(db, userId, programId);
}

export function deletePlannedSession(db: Db, userId: string, id: string): ProgramTree {
  const programId = ownerOf(db, userId, "planned session", id);
  db.prepare("DELETE FROM planned_session WHERE id = ?").run(id);
  return getProgram(db, userId, programId);
}

// Plan lines

export type PlanItemInput = {
  exercise_id: string | null;
  label: string | null;
  sets: Range | null;
  reps: Range | null;
  distance_m: Range | null;
  duration_s: Range | null;
  to_max: boolean;
  load_kg: number | null;
  load_pct: number | null;
  load_ref_exercise_id: string | null;
  test_kind: TestKind | null;
  rest: string | null;
  note: string | null;
};
export type PlanItemPatch = Partial<PlanItemInput>;

const pair = (min: number | null, max: number | null): Range | null => (min === null || max === null ? null : [min, max]);

function rowToInput(row: PlanItemRow): PlanItemInput {
  return {
    exercise_id: row.exercise_id,
    label: row.label,
    sets: pair(row.sets_min, row.sets_max),
    reps: pair(row.reps_min, row.reps_max),
    distance_m: pair(row.distance_min_m, row.distance_max_m),
    duration_s: pair(row.duration_min_s, row.duration_max_s),
    to_max: toBool(row.to_max),
    load_kg: row.load_kg,
    load_pct: row.load_pct,
    load_ref_exercise_id: row.load_ref_exercise_id,
    test_kind: row.test_kind,
    rest: row.rest,
    note: row.note,
  };
}

// A line with an exercise may only have targets in fields the exercise has; a line without one is a note.
export function checkItem(db: Db, userId: string, input: PlanItemInput): void {
  if (input.exercise_id === null) {
    const targets = [input.label, input.sets, input.reps, input.distance_m, input.duration_s, input.load_kg, input.load_pct, input.load_ref_exercise_id, input.test_kind];
    if (!input.note?.trim()) throw new InvalidError("a line without exercise needs a note");
    if (input.to_max || targets.some((t) => t !== null)) throw new InvalidError("a line without exercise has no targets");
    return;
  }
  const { fields } = getExercise(db, userId, input.exercise_id);
  const needs: [unknown, string, boolean][] = [
    [input.reps, "reps", fields.includes("reps")],
    [input.distance_m, "distance_m", fields.includes("distance")],
    [input.duration_s, "duration_s", fields.includes("duration")],
    [input.load_kg ?? input.load_pct, "load", fields.includes("weight")],
  ];
  for (const [value, name, has] of needs) if (value !== null && !has) throw new InvalidError(`${name} not allowed for this exercise`);
  if (input.load_kg !== null && input.load_pct !== null) throw new InvalidError("load_kg and load_pct exclude each other");
  if ((input.load_pct === null) !== (input.load_ref_exercise_id === null)) throw new InvalidError("load_pct and load_ref_exercise_id belong together");
  if (input.load_ref_exercise_id !== null && !getExercise(db, userId, input.load_ref_exercise_id).fields.includes("weight")) {
    throw new InvalidError("load_ref_exercise_id needs an exercise with weight");
  }
  if (input.test_kind === "one_rm" && !fields.includes("weight")) throw new InvalidError("a 1RM test needs an exercise with weight");
}

// itemId null = insert. Inside a transaction of the caller.
export function writeItem(db: Db, plannedSessionId: string, itemId: string | null, input: PlanItemInput): void {
  const [sMin, sMax] = input.sets ?? [null, null];
  const [rMin, rMax] = input.reps ?? [null, null];
  const [dMin, dMax] = input.distance_m ?? [null, null];
  const [tMin, tMax] = input.duration_s ?? [null, null];
  const values = [
    input.exercise_id,
    input.label,
    sMin,
    sMax,
    rMin,
    rMax,
    dMin,
    dMax,
    tMin,
    tMax,
    input.to_max ? 1 : 0,
    input.load_kg,
    input.load_pct,
    input.load_ref_exercise_id,
    input.test_kind,
    input.rest,
    input.note,
  ];
  if (itemId === null) {
    db.prepare(
      `INSERT INTO planned_item (id, planned_session_id, position, exercise_id, label, sets_min, sets_max, reps_min, reps_max,
         distance_min_m, distance_max_m, duration_min_s, duration_max_s, to_max, load_kg, load_pct, load_ref_exercise_id,
         test_kind, rest, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), plannedSessionId, nextPosition(db, "planned_item", "planned_session_id", plannedSessionId), ...values);
  } else {
    db.prepare(
      `UPDATE planned_item SET exercise_id = ?, label = ?, sets_min = ?, sets_max = ?, reps_min = ?, reps_max = ?,
         distance_min_m = ?, distance_max_m = ?, duration_min_s = ?, duration_max_s = ?, to_max = ?, load_kg = ?, load_pct = ?,
         load_ref_exercise_id = ?, test_kind = ?, rest = ?, note = ? WHERE id = ?`,
    ).run(...values, itemId);
  }
}

export function addPlanItem(db: Db, userId: string, plannedSessionId: string, input: PlanItemInput): ProgramTree {
  const programId = ownerOf(db, userId, "planned session", plannedSessionId);
  transaction(db, () => {
    checkItem(db, userId, input);
    if (input.exercise_id !== null) assertUsable(getExercise(db, userId, input.exercise_id));
    writeItem(db, plannedSessionId, null, input);
  });
  return getProgram(db, userId, programId);
}

// Fields left out stay; null clears. The result as a whole must fit the exercise.
export function updatePlanItem(db: Db, userId: string, itemId: string, patch: PlanItemPatch): ProgramTree {
  const programId = ownerOf(db, userId, "plan line", itemId);
  transaction(db, () => {
    const row = db.prepare(`SELECT ${ITEM_COLUMNS} FROM planned_item WHERE id = ?`).get(itemId) as PlanItemRow;
    const given = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const merged = { ...rowToInput(row), ...given };
    checkItem(db, userId, merged);
    if (merged.exercise_id !== null && merged.exercise_id !== row.exercise_id) assertUsable(getExercise(db, userId, merged.exercise_id));
    writeItem(db, "", itemId, merged);
  });
  return getProgram(db, userId, programId);
}

export function deletePlanItem(db: Db, userId: string, itemId: string): ProgramTree {
  const programId = ownerOf(db, userId, "plan line", itemId);
  db.prepare("DELETE FROM planned_item WHERE id = ?").run(itemId);
  return getProgram(db, userId, programId);
}

// The new order of all lines of a planned session; anything but exactly those ids is refused.
export function setItemOrder(db: Db, userId: string, plannedSessionId: string, itemIds: string[]): ProgramTree {
  const programId = ownerOf(db, userId, "planned session", plannedSessionId);
  transaction(db, () => {
    const current = (db.prepare("SELECT id FROM planned_item WHERE planned_session_id = ?").all(plannedSessionId) as { id: string }[]).map((r) => r.id);
    const same = itemIds.length === current.length && new Set(itemIds).size === current.length && itemIds.every((id) => current.includes(id));
    if (!same) throw new InvalidError("item_ids must list every line of the planned session once");
    const update = db.prepare("UPDATE planned_item SET position = ? WHERE id = ?");
    itemIds.forEach((id, position) => update.run(position, id));
  });
  return getProgram(db, userId, programId);
}

// Training from the plan

// A session for the planned session: one block per plan line with an exercise, remembering where it came from. Given
// started_at and ended_at it is entered afterwards (it then leaves an open session running); otherwise it starts now
// and ends the open one. After that it is a normal session.
export function startPlannedSession(db: Db, userId: string, plannedSessionId: string, times: { started_at?: string; ended_at?: string }): SessionTree {
  ownerOf(db, userId, "planned session", plannedSessionId);
  const sessionId = transaction(db, () => {
    const head = db
      .prepare("SELECT ps.label, w.number FROM planned_session ps JOIN program_week w ON w.id = ps.week_id WHERE ps.id = ?")
      .get(plannedSessionId) as { label: string; number: number };
    const id = insertSession(db, userId, { ...times, title: `Woche ${head.number} · ${head.label}` }, plannedSessionId);
    const items = db
      .prepare("SELECT id, exercise_id FROM planned_item WHERE planned_session_id = ? AND exercise_id IS NOT NULL ORDER BY position")
      .all(plannedSessionId) as { id: string; exercise_id: string }[];
    for (const item of items) {
      assertUsable(getExercise(db, userId, item.exercise_id));
      insertBlock(db, id, item.exercise_id, item.id);
    }
    return id;
  });
  return getSession(db, userId, sessionId);
}
