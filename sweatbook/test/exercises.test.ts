import { test } from "node:test";
import assert from "node:assert/strict";
import { deadhang, pullup, sessionWith, setup, squat } from "./helpers.ts";

test("exercise: create with aliases, read, list", async () => {
  const { call } = setup();
  const created = await call("POST", "/api/exercises", { ...squat, note: "Low bar", aliases: [" Back  Squat ", "back squat", "Kniebeuge"] });
  assert.equal(created.status, 201);
  // spaces collapsed, duplicates and the own name dropped
  assert.deepEqual(created.json.aliases, ["Back Squat"]);
  assert.equal(created.json.archived, false);
  assert.equal(created.json.last_used_at, null);
  assert.equal((await call("GET", `/api/exercises/${created.json.id}`)).json.note, "Low bar");
  assert.equal((await call("GET", "/api/exercises")).json.length, 1);
});

test("exercise: names and aliases are unique across the catalog, case ignored (also for umlauts)", async () => {
  const { call } = setup();
  await call("POST", "/api/exercises", { ...pullup, aliases: ["Pull-up"] });
  const sameName = await call("POST", "/api/exercises", { name: "KLIMMZÜGE", fields: ["weight", "reps"] });
  assert.equal(sameName.status, 409);
  assert.equal(sameName.json.taken_by, "Klimmzüge");
  assert.equal((await call("POST", "/api/exercises", { name: "pull-up", fields: ["weight", "reps"] })).status, 409);
  assert.equal((await call("POST", "/api/exercises", { ...squat, aliases: ["pull-up"] })).status, 409);
  assert.equal((await call("POST", "/api/exercises", squat)).status, 201);
});

test("exercise: validation", async () => {
  const { call } = setup();
  assert.equal((await call("POST", "/api/exercises", { name: " ", fields: ["weight", "reps"] })).status, 400);
  assert.equal((await call("POST", "/api/exercises", { name: "X", fields: ["speed"] })).status, 400);
  assert.equal((await call("POST", "/api/exercises", { name: "X", fields: ["weight"] })).status, 400, "kg alone says nothing");
  assert.equal((await call("POST", "/api/exercises", { name: "X", fields: [] })).status, 400);
  assert.equal((await call("POST", "/api/exercises", { name: "X", metrics: "weight_reps" })).status, 400, "the old kinds are gone");
  assert.equal((await call("GET", "/api/exercises/not-a-uuid")).status, 400);
  assert.equal((await call("GET", "/api/exercises/00000000-0000-4000-8000-000000000000")).status, 404);
});

test("exercise: search finds name or alias, recently used first", async () => {
  const { call } = setup();
  const a = (await call("POST", "/api/exercises", { name: "Rudern vorgebeugt", fields: ["weight", "reps"] })).json;
  const b = (await call("POST", "/api/exercises", { name: "Bankziehen", fields: ["weight", "reps"], aliases: ["Bench Pull"] })).json;
  await call("POST", "/api/exercises", squat);
  assert.deepEqual((await call("GET", "/api/exercises?q=bench")).json.map((e: any) => e.id), [b.id]);
  assert.deepEqual((await call("GET", "/api/exercises?q=RUD")).json.map((e: any) => e.id), [a.id]);
  await sessionWith(call, [b.id]);
  const all = (await call("GET", "/api/exercises")).json;
  assert.equal(all[0].id, b.id);
  assert.equal(all[0].last_used_at, "2026-10-24T11:00:00.000Z");
  assert.deepEqual(all.slice(1).map((e: any) => e.name), ["Kniebeuge", "Rudern vorgebeugt"]);
});

test("exercise: update; fields can be added any time, removed only while no set has a value in them", async () => {
  const { call } = setup();
  const e = (await call("POST", "/api/exercises", { name: "Hang", fields: ["weight", "reps"], aliases: ["Dead hang"] })).json;
  const renamed = await call("PATCH", `/api/exercises/${e.id}`, { name: "Deadhang", fields: ["duration", "weight", "duration"], note: "" });
  assert.equal(renamed.json.name, "Deadhang");
  assert.deepEqual(renamed.json.fields, ["weight", "duration"], "duplicates dropped, canonical order");
  assert.deepEqual(renamed.json.aliases, ["Dead hang"]);
  assert.equal(renamed.json.note, null);
  const tree = await sessionWith(call, [e.id]);
  await call("POST", `/api/block-exercises/${tree.blocks[0].exercises[0].id}/sets`, { sets: [{ duration_s: 60 }] });
  const removeUsed = await call("PATCH", `/api/exercises/${e.id}`, { fields: ["weight", "reps"] });
  assert.equal(removeUsed.status, 409);
  assert.equal(removeUsed.json.field, "duration");
  assert.deepEqual(removeUsed.json.fields, ["duration"], "every field still holding values is named");
  // kg was never filled in: it may go; distance may be added next to the used time
  assert.deepEqual((await call("PATCH", `/api/exercises/${e.id}`, { fields: ["duration", "distance"] })).json.fields, ["distance", "duration"]);
  assert.equal((await call("PATCH", `/api/exercises/${e.id}`, { fields: ["duration"], aliases: [] })).json.aliases.length, 0);
});

test("exercise: archived ones cannot be added; used ones cannot be deleted", async () => {
  const { call } = setup();
  const e = (await call("POST", "/api/exercises", deadhang)).json;
  const unused = (await call("POST", "/api/exercises", squat)).json;
  const tree = await sessionWith(call, [e.id]);
  assert.equal((await call("DELETE", `/api/exercises/${e.id}`)).status, 409);
  assert.equal((await call("PATCH", `/api/exercises/${e.id}`, { archived: true })).json.archived, true);
  assert.equal((await call("POST", `/api/sessions/${tree.id}/blocks`, { exercise_id: e.id })).status, 409);
  assert.equal((await call("DELETE", `/api/exercises/${unused.id}`)).status, 204);
});

test("exercise: every user has an own catalog", async () => {
  const { as } = setup();
  const anna = as("anna");
  const ben = as("ben");
  const e = (await anna("POST", "/api/exercises", squat)).json;
  assert.equal((await ben("GET", "/api/exercises")).json.length, 0);
  assert.equal((await ben("GET", `/api/exercises/${e.id}`)).status, 404);
  assert.equal((await ben("POST", "/api/exercises", squat)).status, 201);
});
