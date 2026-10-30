import type { Db } from "../db.ts";
import { addBlock } from "./blocks.ts";
import { assertUsable, resolveExercise } from "./exercises.ts";
import { createSession, findOpenSession, getSession, type SessionTree } from "./sessions.ts";
import { addSets, checkSet, type SetInput } from "./sets.ts";

export type LogSetsInput = { exercise: string; sets: SetInput[]; session_id?: string };

// Log sets for an exercise by its name: into the given session, else the open one, else a new one. The exercise gets a
// block in the session if it has none yet. Answers with the whole session.
// createSession, addBlock and addSets each open their own transaction (SQLite has no nested BEGIN), so everything that can
// be refused is checked first; only an unexpected error in between could leave an empty block behind.
export function logSets(db: Db, userId: string, input: LogSetsInput): SessionTree {
  const exercise = resolveExercise(db, userId, input.exercise);
  assertUsable(exercise);
  for (const set of input.sets) checkSet(exercise.fields, set);

  let session = input.session_id ? getSession(db, userId, input.session_id) : (findOpenSession(db, userId) ?? createSession(db, userId, {}));
  let entry = session.blocks.flatMap((b) => b.exercises).find((e) => e.exercise.id === exercise.id);
  if (!entry) {
    session = addBlock(db, userId, session.id, exercise.id);
    entry = session.blocks.flatMap((b) => b.exercises).find((e) => e.exercise.id === exercise.id)!;
  }
  addSets(db, userId, entry.id, input.sets);
  return getSession(db, userId, session.id);
}
