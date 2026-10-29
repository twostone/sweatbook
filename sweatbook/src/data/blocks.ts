import { transaction, type Db } from "../db.ts";
import { ConflictError, InvalidError, newId, nextPosition, NotFoundError } from "./common.ts";
import { assertUsable, getExercise } from "./exercises.ts";
import { assertSessionOwned, getSession, type SessionTree } from "./sessions.ts";
import { insertSet, ownedBlockExercise, type SetInput } from "./sets.ts";

// A block is one exercise ("straight") or several done in turns ("superset", A1/A2/…). The type follows the number of
// exercises; later block types (circuit, amrap, emom, intervals) will set it explicitly and use `params`.

type BlockRow = { id: string; session_id: string; type: "straight" | "superset" };

function ownedBlock(db: Db, userId: string, blockId: string): BlockRow {
  const row = db
    .prepare("SELECT b.id, b.session_id, b.type FROM block b JOIN session s ON s.id = b.session_id WHERE b.id = ? AND s.user_id = ?")
    .get(blockId, userId) as BlockRow | undefined;
  if (!row) throw new NotFoundError("block");
  return row;
}

function insertBlockExercise(db: Db, blockId: string, exerciseId: string, plannedItemId: string | null = null): void {
  db.prepare("INSERT INTO block_exercise (id, block_id, exercise_id, position, planned_item_id) VALUES (?, ?, ?, ?, ?)").run(
    newId(),
    blockId,
    exerciseId,
    nextPosition(db, "block_exercise", "block_id", blockId),
    plannedItemId,
  );
}

// A new block with one exercise at the end of the session, inside a transaction of the caller.
export function insertBlock(db: Db, sessionId: string, exerciseId: string, plannedItemId: string | null = null): void {
  const blockId = newId();
  db.prepare("INSERT INTO block (id, session_id, position, type, params) VALUES (?, ?, ?, 'straight', NULL)").run(
    blockId,
    sessionId,
    nextPosition(db, "block", "session_id", sessionId),
  );
  insertBlockExercise(db, blockId, exerciseId, plannedItemId);
}

// A new block with one exercise, appended at the end of the session.
export function addBlock(db: Db, userId: string, sessionId: string, exerciseId: string): SessionTree {
  transaction(db, () => {
    assertSessionOwned(db, userId, sessionId);
    assertUsable(getExercise(db, userId, exerciseId));
    insertBlock(db, sessionId, exerciseId);
  });
  return getSession(db, userId, sessionId);
}

const exerciseCount = (db: Db, blockId: string): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM block_exercise WHERE block_id = ?").get(blockId) as { n: number }).n;

const setType = (db: Db, blockId: string) =>
  db.prepare("UPDATE block SET type = ? WHERE id = ?").run(exerciseCount(db, blockId) > 1 ? "superset" : "straight", blockId);

// Another exercise in the same block: the block becomes (or stays) a superset.
export function addExerciseToBlock(db: Db, userId: string, blockId: string, exerciseId: string): SessionTree {
  const block = ownedBlock(db, userId, blockId);
  transaction(db, () => {
    assertUsable(getExercise(db, userId, exerciseId));
    const twice = db.prepare("SELECT 1 AS x FROM block_exercise WHERE block_id = ? AND exercise_id = ?").get(blockId, exerciseId);
    if (twice) throw new ConflictError("exercise already in block");
    insertBlockExercise(db, blockId, exerciseId);
    setType(db, blockId);
  });
  return getSession(db, userId, block.session_id);
}

// The new order of all blocks of the session; anything but exactly those ids is refused.
export function setBlockOrder(db: Db, userId: string, sessionId: string, blockIds: string[]): SessionTree {
  transaction(db, () => {
    assertSessionOwned(db, userId, sessionId);
    const current = (db.prepare("SELECT id FROM block WHERE session_id = ?").all(sessionId) as { id: string }[]).map((r) => r.id);
    const same = blockIds.length === current.length && new Set(blockIds).size === current.length && blockIds.every((id) => current.includes(id));
    if (!same) throw new InvalidError("block_ids must list every block of the session once");
    const update = db.prepare("UPDATE block SET position = ? WHERE id = ?");
    blockIds.forEach((id, position) => update.run(position, id));
  });
  return getSession(db, userId, sessionId);
}

export function deleteBlock(db: Db, userId: string, blockId: string): SessionTree {
  const block = ownedBlock(db, userId, blockId);
  db.prepare("DELETE FROM block WHERE id = ?").run(blockId);
  return getSession(db, userId, block.session_id);
}

// Taking an exercise out of a block (with its sets). The last one takes the block with it; one left is no superset.
export function removeBlockExercise(db: Db, userId: string, blockExerciseId: string): SessionTree {
  const owner = ownedBlockExercise(db, userId, blockExerciseId);
  transaction(db, () => {
    db.prepare("DELETE FROM block_exercise WHERE id = ?").run(blockExerciseId);
    if (exerciseCount(db, owner.block_id) === 0) db.prepare("DELETE FROM block WHERE id = ?").run(owner.block_id);
    else setType(db, owner.block_id);
  });
  return getSession(db, userId, owner.session_id);
}

// Fields left out stay; null clears the note.
export function updateBlockExercise(db: Db, userId: string, blockExerciseId: string, patch: { note?: string | null }): SessionTree {
  const owner = ownedBlockExercise(db, userId, blockExerciseId);
  if (patch.note !== undefined) db.prepare("UPDATE block_exercise SET note = ? WHERE id = ?").run(patch.note, blockExerciseId);
  return getSession(db, userId, owner.session_id);
}

export type RoundInput = SetInput & { block_exercise_id: string };

// "+ Runde" in a superset: one set for every exercise of the block, all or none. The client fills in the values
// (usually its last set), so the server needs no guess for an exercise without sets yet.
export function addRound(db: Db, userId: string, blockId: string, sets: RoundInput[]): SessionTree {
  const block = ownedBlock(db, userId, blockId);
  transaction(db, () => {
    const members = (db.prepare("SELECT id FROM block_exercise WHERE block_id = ?").all(blockId) as { id: string }[]).map((r) => r.id);
    const given = sets.map((s) => s.block_exercise_id);
    const complete = given.length === members.length && new Set(given).size === members.length && given.every((id) => members.includes(id));
    if (!complete) throw new InvalidError("a round needs one set for every exercise of the block");
    for (const { block_exercise_id, ...input } of sets) insertSet(db, ownedBlockExercise(db, userId, block_exercise_id), input);
  });
  return getSession(db, userId, block.session_id);
}
