import { isoNow, transaction, type Db } from "../db.ts";
import { InvalidError, newId, NotFoundError } from "./common.ts";
import { getExercise, type Field } from "./exercises.ts";
import { plannedOfBlockExercise, planOfSession, PlanContext, type SessionPlan, type SessionPlanned } from "./plan.ts";
import { SET_COLUMNS, toSet, type SetLog } from "./sets.ts";

export type SessionSummary = {
  id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  block_count: number;
  set_count: number;
};

// What the user did with this exercise the last time before this session (the hint above the set rows).
export type LastTime = { session_id: string; started_at: string; sets: SetLog[] };

export type SessionExercise = {
  id: string; // block_exercise id: sets are added to this
  position: number;
  exercise: { id: string; name: string; fields: Field[]; archived: boolean };
  note: string | null; // for this session only, unlike the catalog note
  sets: SetLog[];
  last_time: LastTime | null;
  planned: SessionPlanned | null; // the plan line this exercise came from, with targets and computed weight
};
export type SessionBlock = { id: string; position: number; type: "straight" | "superset"; exercises: SessionExercise[] };
export type SessionTree = Omit<SessionSummary, "block_count" | "set_count"> & { plan: SessionPlan | null; blocks: SessionBlock[] };

export type SessionInput = { title?: string | null; started_at?: string; ended_at?: string; note?: string | null };
export type SessionPatch = { title?: string | null; started_at?: string; ended_at?: string | null; note?: string | null };

type SessionRow = { id: string; title: string | null; started_at: string; ended_at: string | null; note: string | null; planned_session_id: string | null };

const MAX_LIST = 100;

export function listSessions(db: Db, userId: string, opts: { before?: string; limit?: number } = {}): SessionSummary[] {
  const limit = Math.min(opts.limit ?? 20, MAX_LIST);
  return db
    .prepare(
      `SELECT s.id, s.title, s.started_at, s.ended_at, s.note,
         (SELECT COUNT(*) FROM block b WHERE b.session_id = s.id) AS block_count,
         (SELECT COUNT(*) FROM set_log l JOIN block_exercise be ON be.id = l.block_exercise_id
            JOIN block b ON b.id = be.block_id WHERE b.session_id = s.id) AS set_count
       FROM session s
       WHERE s.user_id = ? AND (? IS NULL OR s.started_at < ?)
       ORDER BY s.started_at DESC, s.id DESC
       LIMIT ?`,
    )
    .all(userId, opts.before ?? null, opts.before ?? null, limit) as SessionSummary[];
}

function sessionRow(db: Db, userId: string, id: string): SessionRow {
  const row = db.prepare("SELECT id, title, started_at, ended_at, note, planned_session_id FROM session WHERE id = ? AND user_id = ?").get(id, userId) as
    | SessionRow
    | undefined;
  if (!row) throw new NotFoundError("session");
  return row;
}

export function assertSessionOwned(db: Db, userId: string, id: string): void {
  sessionRow(db, userId, id);
}

// Only one session is open at a time: starting (or reopening) one ends the others, at the time of their last set,
// or at their start when they have none. Inside a transaction of the caller.
function endOtherOpenSessions(db: Db, userId: string, exceptId: string): void {
  db.prepare(
    `UPDATE session SET ended_at = COALESCE(
        (SELECT MAX(l.logged_at) FROM set_log l JOIN block_exercise be ON be.id = l.block_exercise_id
           JOIN block b ON b.id = be.block_id WHERE b.session_id = session.id),
        started_at)
     WHERE user_id = ? AND ended_at IS NULL AND id <> ?`,
  ).run(userId, exceptId);
}

// Inside a transaction of the caller. A session given an end is one entered afterwards: it is done at once, so it
// leaves an open session running.
export function insertSession(db: Db, userId: string, input: SessionInput, plannedSessionId: string | null = null): string {
  const id = newId();
  const now = isoNow();
  const startedAt = input.started_at ?? now;
  const endedAt = input.ended_at ?? null;
  if (endedAt !== null && endedAt < startedAt) throw new InvalidError("ended_at before started_at");
  if (endedAt === null) endOtherOpenSessions(db, userId, id);
  db.prepare("INSERT INTO session (id, user_id, title, started_at, ended_at, note, created_at, planned_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id,
    userId,
    input.title ?? null,
    startedAt,
    endedAt,
    input.note ?? null,
    now,
    plannedSessionId,
  );
  return id;
}

export function createSession(db: Db, userId: string, input: SessionInput): SessionTree {
  const id = transaction(db, () => insertSession(db, userId, input));
  return getSession(db, userId, id);
}

// Fields left out stay. ended_at null reopens the session (and ends any other open one).
export function updateSession(db: Db, userId: string, id: string, patch: SessionPatch): SessionTree {
  transaction(db, () => {
    const current = sessionRow(db, userId, id);
    const startedAt = patch.started_at ?? current.started_at;
    const endedAt = patch.ended_at !== undefined ? patch.ended_at : current.ended_at;
    if (endedAt !== null && endedAt < startedAt) throw new InvalidError("ended_at before started_at");
    if (endedAt === null) endOtherOpenSessions(db, userId, id);
    db.prepare("UPDATE session SET title = ?, started_at = ?, ended_at = ?, note = ? WHERE id = ?").run(
      patch.title !== undefined ? patch.title : current.title,
      startedAt,
      endedAt,
      patch.note !== undefined ? patch.note : current.note,
      id,
    );
  });
  return getSession(db, userId, id);
}

export function deleteSession(db: Db, userId: string, id: string): void {
  sessionRow(db, userId, id);
  db.prepare("DELETE FROM session WHERE id = ?").run(id);
}

function setsOf(db: Db, blockExerciseId: string): SetLog[] {
  const rows = db.prepare(`SELECT ${SET_COLUMNS} FROM set_log l WHERE l.block_exercise_id = ? ORDER BY l.position`).all(blockExerciseId);
  return (rows as Parameters<typeof toSet>[0][]).map(toSet);
}

// The sets of one exercise within one session, in the order they appear (block, then exercise, then set).
function setsInSession(db: Db, sessionId: string, exerciseId: string): SetLog[] {
  const rows = db
    .prepare(
      `SELECT ${SET_COLUMNS} FROM set_log l
       JOIN block_exercise be ON be.id = l.block_exercise_id
       JOIN block b ON b.id = be.block_id
       WHERE b.session_id = ? AND be.exercise_id = ?
       ORDER BY b.position, be.position, l.position`,
    )
    .all(sessionId, exerciseId);
  return (rows as Parameters<typeof toSet>[0][]).map(toSet);
}

// The latest earlier session (by start, not by entry) with at least one set of this exercise.
export function lastTime(db: Db, userId: string, exerciseId: string, session: { id: string; started_at: string }): LastTime | null {
  const row = db
    .prepare(
      `SELECT s.id, s.started_at FROM session s
       JOIN block b ON b.session_id = s.id
       JOIN block_exercise be ON be.block_id = b.id
       JOIN set_log l ON l.block_exercise_id = be.id
       WHERE s.user_id = ? AND be.exercise_id = ? AND s.id <> ? AND s.started_at < ?
       ORDER BY s.started_at DESC LIMIT 1`,
    )
    .get(userId, exerciseId, session.id, session.started_at) as { id: string; started_at: string } | undefined;
  return row ? { session_id: row.id, started_at: row.started_at, sets: setsInSession(db, row.id, exerciseId) } : null;
}

// The whole session in one answer, so overview and exercise pages need no further requests.
export function getSession(db: Db, userId: string, id: string): SessionTree {
  const session = sessionRow(db, userId, id);
  const blocks = db.prepare("SELECT id, position, type FROM block WHERE session_id = ? ORDER BY position").all(id) as {
    id: string;
    position: number;
    type: "straight" | "superset";
  }[];
  const exercisesOf = db.prepare("SELECT id, position, exercise_id, note, planned_item_id FROM block_exercise WHERE block_id = ? ORDER BY position");
  const { planned_session_id, ...fields } = session;
  const ctx = new PlanContext(db, userId);
  return {
    ...fields,
    plan: planOfSession(db, planned_session_id),
    blocks: blocks.map((block) => ({
      ...block,
      exercises: (exercisesOf.all(block.id) as { id: string; position: number; exercise_id: string; note: string | null; planned_item_id: string | null }[]).map((be) => {
        const exercise = getExercise(db, userId, be.exercise_id);
        return {
          id: be.id,
          position: be.position,
          exercise: { id: exercise.id, name: exercise.name, fields: exercise.fields, archived: exercise.archived },
          note: be.note,
          sets: setsOf(db, be.id),
          last_time: lastTime(db, userId, be.exercise_id, session),
          planned: plannedOfBlockExercise(ctx, be.planned_item_id, be.id, session.started_at.slice(0, 10)),
        };
      }),
    })),
  };
}

export type HistoryEntry = { session_id: string; title: string | null; started_at: string; sets: SetLog[] };

// Every session with sets of this exercise, newest first; `before` (a started_at) pages further back.
export function exerciseHistory(
  db: Db,
  userId: string,
  exerciseId: string,
  opts: { before?: string; limit?: number } = {},
): HistoryEntry[] {
  getExercise(db, userId, exerciseId);
  const sessions = db
    .prepare(
      `SELECT DISTINCT s.id, s.title, s.started_at FROM session s
       JOIN block b ON b.session_id = s.id
       JOIN block_exercise be ON be.block_id = b.id
       JOIN set_log l ON l.block_exercise_id = be.id
       WHERE s.user_id = ? AND be.exercise_id = ? AND (? IS NULL OR s.started_at < ?)
       ORDER BY s.started_at DESC, s.id DESC
       LIMIT ?`,
    )
    .all(userId, exerciseId, opts.before ?? null, opts.before ?? null, Math.min(opts.limit ?? 20, MAX_LIST)) as {
    id: string;
    title: string | null;
    started_at: string;
  }[];
  return sessions.map((s) => ({ session_id: s.id, title: s.title, started_at: s.started_at, sets: setsInSession(db, s.id, exerciseId) }));
}
