import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setup } from "./helpers.ts";

const example = () => JSON.parse(readFileSync(new URL("../examples/programm-beispiel.json", import.meta.url), "utf8"));

test("import: the example file becomes a whole program; earlier weeks count as done before the app", async () => {
  const { call } = setup();
  const res = await call("POST", "/api/programs/import", { file: example() });
  assert.equal(res.status, 201);
  const p = res.json.program;
  assert.deepEqual(res.json.new_exercises, ["Bankziehen", "Langhantelrudern vorgebeugt", "Dead Hang", "Farmer's Walk"]);
  assert.deepEqual([p.name, p.total, p.done, p.next.week, p.next.label], ["Beispiel-Plan (3 Wochen)", 5, 2, 2, "A"]);
  assert.deepEqual(p.weeks[0].sessions.map((s: any) => [s.state, s.skip_note]), [["skipped", "vor der App"], ["skipped", "vor der App"]]);
  assert.equal(p.weeks[2].deload, true);
  // lines: percent of the 1RM from the file's test values, a fixed load, a note line, a test line
  const a = p.weeks[1].sessions[0].items;
  assert.deepEqual([a[0].exercise, a[0].note], [null, "Aufwärmen: 5 Min Rudergerät"]);
  assert.deepEqual([a[1].weight_kg, a[1].reps, a[1].rest], [85, [3, 5], "3–4 Min"]);
  assert.deepEqual([a[2].label, a[2].weight_kg], ["schwer", 75]);
  const b = p.weeks[1].sessions[1].items;
  assert.deepEqual([b[0].to_max, b[0].weight_kg, b[2].distance_m], [true, 40, [60, 60]]);
  assert.equal(p.weeks[2].sessions[0].items[1].test_kind, "one_rm");
  assert.deepEqual(p.tests.map((t: any) => [t.exercise_name, t.kind]).sort(), [["Bankziehen", "best"], ["Bankziehen", "one_rm"], ["Dead Hang", "best"]]);
});

test("import: weeks with the same phase name share one phase", async () => {
  const { call } = setup();
  const p = (await call("POST", "/api/programs/import", { file: example() })).json.program;
  assert.deepEqual(p.phases.map((x: any) => x.name), ["Phase 1 – Aufbau", "Phase 2 – Test"]);
  assert.equal(p.weeks[0].phase_id, p.weeks[1].phase_id);
  assert.notEqual(p.weeks[1].phase_id, p.weeks[2].phase_id);
});

test("import: existing exercises are found by name or alias, nothing is duplicated", async () => {
  const { call } = setup();
  const own = (await call("POST", "/api/exercises", { name: "Bench Pull", fields: ["weight", "reps"], aliases: ["bankziehen"] })).json;
  const res = await call("POST", "/api/programs/import", { file: example() });
  assert.equal(res.status, 201);
  assert.ok(!res.json.new_exercises.includes("Bankziehen"));
  const catalog = (await call("GET", "/api/exercises")).json;
  assert.equal(catalog.filter((e: any) => e.id === own.id).length, 1);
  assert.equal(catalog.length, 4);
  assert.equal(res.json.program.weeks[1].sessions[0].items[1].exercise.id, own.id);
});

test("import: dry run reports and creates nothing", async () => {
  const { call } = setup();
  const res = await call("POST", "/api/programs/import", { dry_run: true, file: example() });
  assert.equal(res.status, 200);
  assert.equal(res.json.new_exercises.length, 4);
  assert.deepEqual((await call("GET", "/api/programs")).json, []);
  assert.deepEqual((await call("GET", "/api/exercises")).json, []);
});

test("import: a mistake names the place and nothing is created", async () => {
  const { call } = setup();
  const bad = (change: (f: any) => void) => {
    const f = example();
    change(f);
    return call("POST", "/api/programs/import", { file: f });
  };
  let res = await bad((f) => (f.weeks[1].sessions[0].items[1].load.of = "gibtsnicht"));
  assert.equal(res.status, 400);
  assert.match(res.json.error, /week 2 A, line 2: unknown exercise "gibtsnicht"/);
  res = await bad((f) => (f.weeks[1].sessions[1].items[1].reps = [5, 5])); // a hang has no reps
  assert.match(res.json.error, /week 2 B, line 2: reps not allowed/);
  res = await bad((f) => f.weeks.push({ ...f.weeks[0] }));
  assert.match(res.json.error, /number 1 twice/);
  res = await bad((f) => (f.tests[2].reps = 3)); // dead hang test with reps
  assert.match(res.json.error, /tests\[2\]: reps not allowed/);
  res = await bad((f) => f.exercises.push(f.exercises[0]));
  assert.equal(res.status, 400);
  res = await bad((f) => (f.weeks[0].sessions[0].items[0].lastt = 1)); // misspelled target
  assert.equal(res.status, 400);
  assert.deepEqual((await call("GET", "/api/programs")).json, []);
  assert.deepEqual((await call("GET", "/api/exercises")).json, []);
});

test("import: an archived exercise in the file is refused", async () => {
  const { call } = setup();
  const e = (await call("POST", "/api/exercises", { name: "Bankziehen", fields: ["weight", "reps"] })).json;
  await call("PATCH", `/api/exercises/${e.id}`, { archived: true });
  assert.equal((await call("POST", "/api/programs/import", { file: example() })).status, 409);
});
