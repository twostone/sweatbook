import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, squat } from "./helpers.ts";

test("session: create with a local time, stored as UTC; defaults to now", async () => {
  const { call } = setup();
  const s = await call("POST", "/api/sessions", { title: "Oberkörper A", started_at: "2026-10-24T13:40:00+02:00" });
  assert.equal(s.status, 201);
  assert.equal(s.json.started_at, "2026-10-24T11:40:00.000Z");
  assert.equal(s.json.ended_at, null);
  assert.deepEqual(s.json.blocks, []);
  const now = (await call("POST", "/api/sessions", {})).json;
  assert.ok(Math.abs(Date.parse(now.started_at) - Date.now()) < 5000);
  assert.equal((await call("POST", "/api/sessions", { started_at: "2026-10-24" })).status, 400);
});

test("session: only one is open; a new one ends the previous at its last set", async () => {
  const { call } = setup();
  const e = (await call("POST", "/api/exercises", squat)).json;
  const first = (await call("POST", "/api/sessions", { started_at: "2026-10-20T10:00:00Z" })).json;
  const empty = (await call("POST", "/api/sessions", { started_at: "2026-10-22T10:00:00Z" })).json;
  assert.equal((await call("GET", `/api/sessions/${first.id}`)).json.ended_at, "2026-10-20T10:00:00.000Z");
  const tree = (await call("POST", `/api/sessions/${empty.id}/blocks`, { exercise_id: e.id })).json;
  const set = (await call("POST", `/api/block-exercises/${tree.blocks[0].exercises[0].id}/sets`, { sets: [{ reps: 5 }] })).json[0];
  await call("POST", "/api/sessions", {});
  assert.equal((await call("GET", `/api/sessions/${empty.id}`)).json.ended_at, set.logged_at);
  const open = (await call("GET", "/api/sessions")).json.filter((s: any) => s.ended_at === null);
  assert.equal(open.length, 1);
});

test("session: reopening ends the other open one; end before start is refused", async () => {
  const { call } = setup();
  const a = (await call("POST", "/api/sessions", { started_at: "2026-10-20T10:00:00Z" })).json;
  const b = (await call("POST", "/api/sessions", { started_at: "2026-10-21T10:00:00Z" })).json;
  const reopened = await call("PATCH", `/api/sessions/${a.id}`, { ended_at: null, title: "Nachgetragen" });
  assert.equal(reopened.json.ended_at, null);
  assert.equal(reopened.json.title, "Nachgetragen");
  assert.notEqual((await call("GET", `/api/sessions/${b.id}`)).json.ended_at, null);
  assert.equal((await call("PATCH", `/api/sessions/${a.id}`, { ended_at: "2026-10-19T10:00:00Z" })).status, 400);
  assert.equal((await call("PATCH", `/api/sessions/${a.id}`, { ended_at: "2026-10-20T11:30:00+01:00" })).json.ended_at, "2026-10-20T10:30:00.000Z");
});

test("session: list newest first with counts and paging; delete", async () => {
  const { call } = setup();
  const e = (await call("POST", "/api/exercises", squat)).json;
  const ids: string[] = [];
  for (const day of ["20", "21", "22"]) ids.push((await call("POST", "/api/sessions", { started_at: `2026-10-${day}T10:00:00Z` })).json.id);
  const tree = (await call("POST", `/api/sessions/${ids[2]}/blocks`, { exercise_id: e.id })).json;
  await call("POST", `/api/block-exercises/${tree.blocks[0].exercises[0].id}/sets`, { sets: [{ reps: 5 }, { reps: 5 }] });
  const list = (await call("GET", "/api/sessions?limit=2")).json;
  assert.deepEqual(list.map((s: any) => s.id), [ids[2], ids[1]]);
  assert.equal(list[0].block_count, 1);
  assert.equal(list[0].set_count, 2);
  const older = (await call("GET", `/api/sessions?before=${encodeURIComponent(list[1].started_at)}`)).json;
  assert.deepEqual(older.map((s: any) => s.id), [ids[0]]);
  assert.equal((await call("DELETE", `/api/sessions/${ids[2]}`)).status, 204);
  assert.equal((await call("GET", `/api/sessions/${ids[2]}`)).status, 404);
  // the exercise stays and is deletable again: its sets went with the session
  assert.equal((await call("DELETE", `/api/exercises/${e.id}`)).status, 204);
});

test("session: other users see nothing", async () => {
  const { as } = setup();
  const s = (await as("anna")("POST", "/api/sessions", {})).json;
  const ben = as("ben");
  assert.equal((await ben("GET", `/api/sessions/${s.id}`)).status, 404);
  assert.equal((await ben("PATCH", `/api/sessions/${s.id}`, { title: "x" })).status, 404);
  assert.equal((await ben("DELETE", `/api/sessions/${s.id}`)).status, 404);
  assert.equal((await ben("GET", "/api/sessions")).json.length, 0);
  // Ben's new session does not end Anna's
  await ben("POST", "/api/sessions", {});
  assert.equal((await as("anna")("GET", `/api/sessions/${s.id}`)).json.ended_at, null);
});
