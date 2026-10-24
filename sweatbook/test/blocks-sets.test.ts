import { test } from "node:test";
import assert from "node:assert/strict";
import { deadhang, pullup, sessionWith, setup, squat } from "./helpers.ts";

async function catalog(call: Awaited<ReturnType<typeof setup>>["call"]) {
  const s = (await call("POST", "/api/exercises", squat)).json;
  const p = (await call("POST", "/api/exercises", pullup)).json;
  const d = (await call("POST", "/api/exercises", deadhang)).json;
  const w = (await call("POST", "/api/exercises", { name: "Deadhang Weste", metrics: "weight_duration" })).json;
  return { s, p, d, w };
}

test("sets: fields must fit the exercise", async () => {
  const { call } = setup();
  const { s, d, w } = await catalog(call);
  const tree = await sessionWith(call, [s.id, d.id, w.id]);
  const [sq, dh, ws] = tree.blocks.map((b: any) => b.exercises[0].id);
  const post = (be: string, set: object) => call("POST", `/api/block-exercises/${be}/sets`, { sets: [set] });
  assert.equal((await post(sq, { weight_kg: 100 })).status, 400); // reps missing
  assert.equal((await post(sq, { reps: 5, duration_s: 30 })).status, 400);
  assert.equal((await post(sq, { reps: 10 })).status, 201); // bodyweight
  assert.equal((await post(dh, { duration_s: 72, weight_kg: 10 })).status, 400);
  assert.equal((await post(dh, { reps: 1 })).status, 400);
  assert.equal((await post(dh, { duration_s: 72, is_max: true })).status, 201);
  assert.equal((await post(ws, { duration_s: 40, weight_kg: 10 })).status, 201);
  assert.equal((await post(ws, { duration_s: 40, reps: 1 })).status, 400);
  assert.equal((await post(sq, { reps: -1 })).status, 400);
  assert.equal((await post(sq, { reps: 2.5 })).status, 400);
  assert.equal((await call("POST", `/api/block-exercises/${sq}/sets`, { sets: [] })).status, 400);
});

test("sets: several at once (quick entry), ordered; update and delete", async () => {
  const { call } = setup();
  const { s } = await catalog(call);
  const be = (await sessionWith(call, [s.id])).blocks[0].exercises[0].id;
  const three = await call("POST", `/api/block-exercises/${be}/sets`, { sets: [1, 2, 3].map(() => ({ weight_kg: 100, reps: 5 })) });
  assert.equal(three.status, 201);
  assert.deepEqual(three.json.map((x: any) => x.position), [0, 1, 2]);
  // all or none: one bad set stores nothing
  assert.equal((await call("POST", `/api/block-exercises/${be}/sets`, { sets: [{ reps: 5 }, { weight_kg: 1 }] })).status, 400);
  const id = three.json[2].id;
  const patched = await call("PATCH", `/api/sets/${id}`, { reps: 8, is_max: true, note: "tiefer" });
  assert.deepEqual([patched.json.weight_kg, patched.json.reps, patched.json.is_max, patched.json.note], [100, 8, true, "tiefer"]);
  assert.equal((await call("PATCH", `/api/sets/${id}`, { weight_kg: null })).json.weight_kg, null);
  assert.equal((await call("PATCH", `/api/sets/${id}`, { reps: null })).status, 400);
  assert.equal((await call("PATCH", `/api/sets/${id}`, { note: "" })).json.note, null);
  assert.equal((await call("DELETE", `/api/sets/${id}`)).status, 204);
  assert.equal((await call("DELETE", `/api/sets/${id}`)).status, 404);
});

test("blocks: superset grows and shrinks, order, removal", async () => {
  const { call } = setup();
  const { s, p, d } = await catalog(call);
  let tree = await sessionWith(call, [s.id, d.id]);
  const [first, second] = tree.blocks;
  tree = (await call("POST", `/api/blocks/${first.id}/exercises`, { exercise_id: p.id })).json;
  assert.equal(tree.blocks[0].type, "superset");
  assert.deepEqual(tree.blocks[0].exercises.map((e: any) => e.exercise.name), ["Kniebeuge", "Klimmzüge"]);
  assert.equal((await call("POST", `/api/blocks/${first.id}/exercises`, { exercise_id: p.id })).status, 409);
  tree = (await call("PUT", `/api/sessions/${tree.id}/block-order`, { block_ids: [second.id, first.id] })).json;
  assert.deepEqual(tree.blocks.map((b: any) => b.id), [second.id, first.id]);
  assert.equal((await call("PUT", `/api/sessions/${tree.id}/block-order`, { block_ids: [second.id] })).status, 400);
  assert.equal((await call("PUT", `/api/sessions/${tree.id}/block-order`, { block_ids: [second.id, second.id] })).status, 400);
  tree = (await call("DELETE", `/api/block-exercises/${tree.blocks[1].exercises[0].id}`)).json;
  assert.equal(tree.blocks[1].type, "straight");
  tree = (await call("DELETE", `/api/block-exercises/${tree.blocks[1].exercises[0].id}`)).json;
  assert.equal(tree.blocks.length, 1);
  tree = (await call("DELETE", `/api/blocks/${second.id}`)).json;
  assert.equal(tree.blocks.length, 0);
});

test("rounds: one set per exercise of the superset, all or none", async () => {
  const { call } = setup();
  const { s, p } = await catalog(call);
  let tree = await sessionWith(call, [s.id]);
  tree = (await call("POST", `/api/blocks/${tree.blocks[0].id}/exercises`, { exercise_id: p.id })).json;
  const block = tree.blocks[0];
  const [a1, a2] = block.exercises.map((e: any) => e.id);
  const round = await call("POST", `/api/blocks/${block.id}/rounds`, {
    sets: [
      { block_exercise_id: a1, weight_kg: 80, reps: 8 },
      { block_exercise_id: a2, reps: 10 },
    ],
  });
  assert.equal(round.status, 201);
  assert.deepEqual(round.json.blocks[0].exercises.map((e: any) => e.sets.length), [1, 1]);
  const missing = await call("POST", `/api/blocks/${block.id}/rounds`, { sets: [{ block_exercise_id: a1, reps: 8 }] });
  assert.equal(missing.status, 400);
  const bad = await call("POST", `/api/blocks/${block.id}/rounds`, {
    sets: [
      { block_exercise_id: a1, reps: 8 },
      { block_exercise_id: a2, duration_s: 10 },
    ],
  });
  assert.equal(bad.status, 400);
  const after = (await call("GET", `/api/sessions/${tree.id}`)).json;
  assert.deepEqual(after.blocks[0].exercises.map((e: any) => e.sets.length), [1, 1]);
});

test("last time: the latest earlier session with sets of the exercise, by start time", async () => {
  const { call } = setup();
  const { s, p } = await catalog(call);
  const add = async (startedAt: string, sets: object[]) => {
    const tree = await sessionWith(call, [s.id], startedAt);
    await call("POST", `/api/block-exercises/${tree.blocks[0].exercises[0].id}/sets`, { sets });
    return tree.id;
  };
  const oct10 = await add("2026-10-10T10:00:00Z", [{ weight_kg: 90, reps: 5 }]);
  const oct17 = await add("2026-10-17T10:00:00Z", [{ weight_kg: 100, reps: 5 }, { weight_kg: 100, reps: 5 }]);
  // an earlier session entered afterwards does not count as "last time" for the newer ones
  await add("2026-10-03T10:00:00Z", [{ weight_kg: 80, reps: 5 }]);
  const today = await sessionWith(call, [s.id, p.id], "2026-10-24T10:00:00Z");
  const [squatBlock, pullBlock] = today.blocks;
  assert.equal(squatBlock.exercises[0].last_time.session_id, oct17);
  assert.deepEqual(squatBlock.exercises[0].last_time.sets.map((x: any) => x.weight_kg), [100, 100]);
  assert.equal(pullBlock.exercises[0].last_time, null);
  assert.equal((await call("GET", `/api/sessions/${oct17}`)).json.blocks[0].exercises[0].last_time.session_id, oct10);

  const history = (await call("GET", `/api/exercises/${s.id}/history?limit=2`)).json;
  assert.deepEqual(history.map((h: any) => h.started_at.slice(0, 10)), ["2026-10-17", "2026-10-10"]);
  const older = (await call("GET", `/api/exercises/${s.id}/history?before=${encodeURIComponent(history[1].started_at)}`)).json;
  assert.deepEqual(older.map((h: any) => h.started_at.slice(0, 10)), ["2026-10-03"]);
});

test("blocks and sets: other users get 404", async () => {
  const { as } = setup();
  const anna = as("anna");
  const ben = as("ben");
  const e = (await anna("POST", "/api/exercises", squat)).json;
  const tree = await sessionWith(anna, [e.id]);
  const be = tree.blocks[0].exercises[0].id;
  const set = (await anna("POST", `/api/block-exercises/${be}/sets`, { sets: [{ reps: 5 }] })).json[0];
  const benExercise = (await ben("POST", "/api/exercises", squat)).json;
  assert.equal((await ben("POST", `/api/sessions/${tree.id}/blocks`, { exercise_id: benExercise.id })).status, 404);
  assert.equal((await anna("POST", `/api/sessions/${tree.id}/blocks`, { exercise_id: benExercise.id })).status, 404);
  assert.equal((await ben("POST", `/api/block-exercises/${be}/sets`, { sets: [{ reps: 5 }] })).status, 404);
  assert.equal((await ben("PATCH", `/api/sets/${set.id}`, { reps: 6 })).status, 404);
  assert.equal((await ben("DELETE", `/api/sets/${set.id}`)).status, 404);
  assert.equal((await ben("DELETE", `/api/blocks/${tree.blocks[0].id}`)).status, 404);
  assert.equal((await ben("PATCH", `/api/block-exercises/${be}`, { note: "x" })).status, 404);
  assert.equal((await ben("DELETE", `/api/block-exercises/${be}`)).status, 404);
});

test("block exercises: a note for this session, kept when left out, cleared by empty string", async () => {
  const { call } = setup();
  const { s } = await catalog(call);
  const be = (await sessionWith(call, [s.id])).blocks[0].exercises[0].id;
  const note = (tree: any) => tree.blocks[0].exercises[0].note;
  const patch = (body: object) => call("PATCH", `/api/block-exercises/${be}`, body);
  const set = await patch({ note: " 5 × max, 2 min Pause " });
  assert.equal(set.status, 200);
  assert.equal(note(set.json), "5 × max, 2 min Pause");
  assert.equal(note((await call("GET", `/api/sessions/${set.json.id}`)).json), "5 × max, 2 min Pause");
  assert.equal(note((await patch({})).json), "5 × max, 2 min Pause");
  assert.equal((await patch({ note: "x".repeat(1001) })).status, 400);
  assert.equal(note((await patch({ note: "" })).json), null);
  assert.equal((await call("PATCH", `/api/block-exercises/${crypto.randomUUID()}`, { note: "x" })).status, 404);
});
