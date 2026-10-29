import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, type Call } from "./helpers.ts";

const bench = { name: "Bankziehen", fields: ["weight", "reps"] };
const hang = { name: "Dead Hang", fields: ["weight", "duration"] };

// A program with one week of two planned sessions: A has a %-line, a fixed-load line, a note line and a test line.
async function plan(call: Call) {
  const b = (await call("POST", "/api/exercises", bench)).json;
  const h = (await call("POST", "/api/exercises", hang)).json;
  await call("POST", `/api/exercises/${b.id}/tests`, { kind: "one_rm", tested_on: "2026-08-31", weight_kg: 115 });
  let program = (await call("POST", "/api/programs", { name: "Bankziehen", start_date: "2026-08-31" })).json;
  program = (await call("POST", `/api/programs/${program.id}/weeks`, { phase: "Block 2 – Maximalkraft I" })).json;
  const week = program.weeks[0];
  program = (await call("POST", `/api/weeks/${week.id}/sessions`, { label: "A" })).json;
  program = (await call("POST", `/api/weeks/${week.id}/sessions`, { label: "B" })).json;
  const [a, bSession] = program.weeks[0].sessions;
  const add = async (session: string, body: unknown) => (await call("POST", `/api/planned-sessions/${session}/items`, body)).json;
  await add(a.id, { note: "Aufwärmen: Rudergerät 5 Min" });
  await add(a.id, { exercise_id: b.id, sets: [4, 4], reps: [3, 5], load_pct: 85, load_ref_exercise_id: b.id, rest: "3–4 Min" });
  await add(a.id, { exercise_id: b.id, label: "mit 45 kg — AMRAP", sets: [1, 1], to_max: true, load_kg: 45 });
  program = await add(a.id, { exercise_id: h.id, label: "Dead-Hang-Test", sets: [1, 1], test_kind: "best" });
  return { b, h, program, a, bSession };
}

test("program: weights come from the newest 1RM up to the training day, rounded to 2.5 kg", async () => {
  const { call } = setup();
  const { b, program } = await plan(call);
  const items = program.weeks[0].sessions[0].items;
  assert.equal(items[0].exercise, null);
  assert.equal(items[0].note, "Aufwärmen: Rudergerät 5 Min");
  assert.deepEqual([items[1].sets, items[1].reps, items[1].weight_kg, items[1].rest], [[4, 4], [3, 5], 97.5, "3–4 Min"]); // 97.75
  assert.deepEqual([items[2].weight_kg, items[2].to_max, items[2].label], [45, true, "mit 45 kg — AMRAP"]);
  // a newer 1RM changes weights of sessions still to come
  await call("POST", `/api/exercises/${b.id}/tests`, { kind: "one_rm", tested_on: "2026-10-01", weight_kg: 120 });
  assert.equal((await call("GET", `/api/programs/${program.id}`)).json.weeks[0].sessions[0].items[1].weight_kg, 102.5);
});

test("program: without a 1RM the line has the percent only", async () => {
  const { call } = setup();
  const b = (await call("POST", "/api/exercises", bench)).json;
  const p = (await call("POST", "/api/programs", { name: "P", start_date: "2026-08-31" })).json;
  const w = (await call("POST", `/api/programs/${p.id}/weeks`, {})).json.weeks[0];
  const s = (await call("POST", `/api/weeks/${w.id}/sessions`, { label: "A" })).json.weeks[0].sessions[0];
  const item = (await call("POST", `/api/planned-sessions/${s.id}/items`, { exercise_id: b.id, load_pct: 80, load_ref_exercise_id: b.id })).json;
  const line = item.weeks[0].sessions[0].items[0];
  assert.deepEqual([line.weight_kg, line.load_pct, line.load_ref.name], [null, 80, "Bankziehen"]);
});

test("program: next workout is the first open one; skip moves on, undo brings it back", async () => {
  const { call } = setup();
  const { program, a, bSession } = await plan(call);
  assert.deepEqual([program.done, program.total, program.next.label, program.next.week], [0, 2, "A", 1]);
  const skipped = (await call("PATCH", `/api/planned-sessions/${a.id}`, { skipped: true, skip_note: "vor der App" })).json;
  assert.deepEqual([skipped.done, skipped.next.planned_session_id], [1, bSession.id]);
  assert.deepEqual([skipped.weeks[0].sessions[0].state, skipped.weeks[0].sessions[0].skip_note], ["skipped", "vor der App"]);
  const undone = (await call("PATCH", `/api/planned-sessions/${a.id}`, { skipped: false })).json;
  assert.deepEqual([undone.done, undone.next.planned_session_id, undone.weeks[0].sessions[0].skip_note], [0, a.id, null]);
});

test("start: a session with a block per exercise line, the note lines on top; it is done once it has sets", async () => {
  const { call } = setup();
  const { b, program, a } = await plan(call);
  const session = (await call("POST", `/api/planned-sessions/${a.id}/start`, {})).json;
  assert.equal(session.title, "Woche 1 · A");
  assert.deepEqual(session.plan.notes, ["Aufwärmen: Rudergerät 5 Min"]);
  assert.equal(session.plan.phase, "Block 2 – Maximalkraft I");
  assert.equal(session.blocks.length, 3);
  const first = session.blocks[0].exercises[0];
  assert.deepEqual([first.exercise.id, first.planned.weight_kg, first.planned.reps], [b.id, 97.5, [3, 5]]);
  // started, but no sets yet: still open, and it knows its session
  let tree = (await call("GET", `/api/programs/${program.id}`)).json;
  assert.deepEqual([tree.weeks[0].sessions[0].state, tree.weeks[0].sessions[0].session_id], ["open", session.id]);
  await call("POST", `/api/block-exercises/${first.id}/sets`, { sets: [{ weight_kg: 97.5, reps: 4 }] });
  tree = (await call("GET", `/api/programs/${program.id}`)).json;
  assert.deepEqual([tree.weeks[0].sessions[0].state, tree.done, tree.next.label], ["done", 1, "B"]);
});

test("start: a second start ends the open session; entered afterwards it leaves it running", async () => {
  const { call } = setup();
  const { a, bSession } = await plan(call);
  const open = (await call("POST", `/api/planned-sessions/${a.id}/start`, {})).json;
  const later = (await call("POST", `/api/planned-sessions/${bSession.id}/start`, { started_at: "2026-09-02T10:00:00Z", ended_at: "2026-09-02T11:00:00Z" })).json;
  assert.notEqual(later.ended_at, null);
  assert.equal((await call("GET", `/api/sessions/${open.id}`)).json.ended_at, null);
  const now = (await call("POST", `/api/planned-sessions/${bSession.id}/start`, {})).json;
  assert.notEqual((await call("GET", `/api/sessions/${open.id}`)).json.ended_at, null);
  assert.equal(now.ended_at, null);
});

test("weights of a done session use the 1RM of its training day", async () => {
  const { call } = setup();
  const { b, program, a } = await plan(call);
  const session = (await call("POST", `/api/planned-sessions/${a.id}/start`, { started_at: "2026-09-02T10:00:00Z", ended_at: "2026-09-02T11:00:00Z" })).json;
  await call("POST", `/api/block-exercises/${session.blocks[0].exercises[0].id}/sets`, { sets: [{ weight_kg: 97.5, reps: 3 }] });
  await call("POST", `/api/exercises/${b.id}/tests`, { kind: "one_rm", tested_on: "2026-10-01", weight_kg: 130 });
  const tree = (await call("GET", `/api/programs/${program.id}`)).json;
  assert.equal(tree.weeks[0].sessions[0].items[1].weight_kg, 97.5); // not 110
  assert.equal((await call("GET", `/api/sessions/${session.id}`)).json.blocks[0].exercises[0].planned.weight_kg, 97.5);
});

test("test line: the best set becomes the test value, follows changes, and goes with its set", async () => {
  const { call } = setup();
  const { h, a } = await plan(call);
  const session = (await call("POST", `/api/planned-sessions/${a.id}/start`, { started_at: "2026-09-02T10:00:00Z" })).json;
  const be = session.blocks[2].exercises[0];
  assert.equal(be.planned.test_kind, "best");
  const sets = (await call("POST", `/api/block-exercises/${be.id}/sets`, { sets: [{ duration_s: 60 }, { duration_s: 74 }, { duration_s: 70 }] })).json;
  let tests = (await call("GET", `/api/exercises/${h.id}/tests`)).json;
  assert.deepEqual([tests.length, tests[0].duration_s, tests[0].kind, tests[0].tested_on, tests[0].set_id], [1, 74, "best", "2026-09-02", sets[1].id]);
  assert.equal((await call("GET", `/api/sessions/${session.id}`)).json.blocks[2].exercises[0].planned.test.duration_s, 74);
  await call("PATCH", `/api/sets/${sets[0].id}`, { duration_s: 80 });
  tests = (await call("GET", `/api/exercises/${h.id}/tests`)).json;
  assert.deepEqual([tests.length, tests[0].duration_s], [1, 80]);
  await call("DELETE", `/api/sets/${sets[0].id}`);
  tests = (await call("GET", `/api/exercises/${h.id}/tests`)).json;
  assert.equal(tests[0].duration_s, 74); // the next best
  assert.equal((await call("DELETE", `/api/tests/${tests[0].id}`)).status, 204); // "Rückgängig"
  assert.deepEqual((await call("GET", `/api/exercises/${h.id}/tests`)).json, []);
});

test("test line with a 1RM: the heaviest set counts and moves the weights of the plan", async () => {
  const { call } = setup();
  const { b, program, bSession } = await plan(call);
  await call("POST", `/api/planned-sessions/${bSession.id}/items`, { exercise_id: b.id, label: "1RM-Test", sets: [3, 3], test_kind: "one_rm" });
  const session = (await call("POST", `/api/planned-sessions/${bSession.id}/start`, { started_at: "2026-09-09T10:00:00Z" })).json;
  await call("POST", `/api/block-exercises/${session.blocks[0].exercises[0].id}/sets`, { sets: [{ weight_kg: 110, reps: 1 }, { weight_kg: 120, reps: 1 }] });
  assert.equal((await call("GET", `/api/programs/${program.id}`)).json.weeks[0].sessions[0].items[1].weight_kg, 102.5); // 120 × 85 %
});

test("tests: values must fit the exercise; a 1RM needs a weight", async () => {
  const { call } = setup();
  const b = (await call("POST", "/api/exercises", bench)).json;
  assert.equal((await call("POST", `/api/exercises/${b.id}/tests`, { kind: "one_rm", reps: 1 })).status, 400);
  assert.equal((await call("POST", `/api/exercises/${b.id}/tests`, { kind: "best", duration_s: 5 })).status, 400);
  assert.equal((await call("POST", `/api/exercises/${b.id}/tests`, { kind: "best", weight_kg: 45, reps: 58 })).status, 201);
});

test("plan lines: targets only in the fields of the exercise; load either fixed or percent", async () => {
  const { call } = setup();
  const { b, h, a } = await plan(call);
  const post = (body: unknown) => call("POST", `/api/planned-sessions/${a.id}/items`, body);
  assert.equal((await post({ exercise_id: h.id, reps: [5, 5] })).status, 400); // a hang has no reps
  assert.equal((await post({ exercise_id: b.id, duration_s: [20, 20] })).status, 400);
  assert.equal((await post({ exercise_id: b.id, load_kg: 45, load_pct: 80, load_ref_exercise_id: b.id })).status, 400);
  assert.equal((await post({ exercise_id: b.id, load_pct: 80 })).status, 400); // percent of what?
  assert.equal((await post({ exercise_id: b.id, reps: [6, 3] })).status, 400);
  assert.equal((await post({})).status, 400); // neither exercise nor note
  assert.equal((await post({ note: "Ruhe", reps: [1, 1] })).status, 400);
  assert.equal((await post({ exercise_id: b.id, test_kind: "one_rm" })).status, 201);
});

test("plan lines: patch keeps what is left out; reorder needs every line once; delete", async () => {
  const { call } = setup();
  const { program, a } = await plan(call);
  const items = program.weeks[0].sessions[0].items;
  const patched = (await call("PATCH", `/api/planned-items/${items[1].id}`, { load_pct: 90, note: "schwer" })).json;
  const line = patched.weeks[0].sessions[0].items[1];
  assert.deepEqual([line.load_pct, line.reps, line.rest, line.note], [90, [3, 5], "3–4 Min", "schwer"]);
  assert.equal((await call("PATCH", `/api/planned-items/${items[1].id}`, { rest: "" })).json.weeks[0].sessions[0].items[1].rest, null);
  const ids = items.map((i: any) => i.id);
  assert.equal((await call("PUT", `/api/planned-sessions/${a.id}/item-order`, { item_ids: ids.slice(1) })).status, 400);
  const reordered = (await call("PUT", `/api/planned-sessions/${a.id}/item-order`, { item_ids: [...ids].reverse() })).json;
  assert.deepEqual(reordered.weeks[0].sessions[0].items.map((i: any) => i.id), [...ids].reverse());
  const removed = (await call("DELETE", `/api/planned-items/${ids[0]}`)).json;
  assert.equal(removed.weeks[0].sessions[0].items.length, 3);
});

test("weeks: a copy takes phase, sessions and lines but starts open; numbers count on", async () => {
  const { call } = setup();
  const { program, a } = await plan(call);
  await call("PATCH", `/api/planned-sessions/${a.id}`, { skipped: true });
  const copied = (await call("POST", `/api/programs/${program.id}/weeks`, { copy_of: program.weeks[0].id, deload: true })).json;
  assert.deepEqual(copied.weeks.map((w: any) => w.number), [1, 2]);
  const copy = copied.weeks[1];
  assert.deepEqual([copy.phase, copy.deload, copy.sessions.map((s: any) => s.label), copy.sessions[0].items.length, copy.sessions[0].state], [
    "Block 2 – Maximalkraft I",
    true,
    ["A", "B"],
    4,
    "open",
  ]);
  assert.equal((await call("PATCH", `/api/weeks/${copy.id}`, { phase: "Block 3", deload: false })).json.weeks[1].phase, "Block 3");
  assert.equal((await call("DELETE", `/api/weeks/${copy.id}`)).json.weeks.length, 1);
});

test("phases: weeks of one name share a phase; rename, note and dissolve work on the phase", async () => {
  const { call, as } = setup();
  let program = (await call("POST", "/api/programs", { name: "Plan", start_date: "2026-08-31" })).json;
  for (const phase of ["Aufbau", "aufbau", "Test", null]) program = (await call("POST", `/api/programs/${program.id}/weeks`, phase ? { phase } : {})).json;
  assert.deepEqual(program.phases.map((p: any) => p.name), ["Aufbau", "Test"]);
  const [w1, w2, w3, w4] = program.weeks;
  assert.deepEqual([w1.phase_id === w2.phase_id, w1.phase_id === w3.phase_id, w4.phase_id], [true, false, null]);

  const [aufbau, test] = program.phases;
  program = (await call("PATCH", `/api/phases/${aufbau.id}`, { name: "Grundlagen", note: "ruhig starten" })).json;
  assert.deepEqual(program.weeks.map((w: any) => w.phase), ["Grundlagen", "Grundlagen", "Test", null]);
  assert.equal(program.phases[0].note, "ruhig starten");
  const taken = await call("PATCH", `/api/phases/${test.id}`, { name: " grundlagen " });
  assert.deepEqual([taken.status, taken.json.taken_by], [409, aufbau.id]);
  assert.equal((await call("PATCH", `/api/phases/${aufbau.id}`, { note: "" })).json.phases[0].note, null);

  const moved = (await call("PATCH", `/api/weeks/${w3.id}`, { phase: "GRUNDLAGEN" })).json;
  assert.deepEqual([moved.phases.map((p: any) => p.name), moved.weeks[2].phase_id === aufbau.id], [["Grundlagen"], true]);

  const stranger = as("ha-user-2");
  assert.equal((await stranger("PATCH", `/api/phases/${aufbau.id}`, { name: "x" })).status, 404);
  assert.equal((await stranger("DELETE", `/api/phases/${aufbau.id}`)).status, 404);

  const dissolved = (await call("DELETE", `/api/phases/${aufbau.id}`)).json;
  assert.deepEqual([dissolved.phases, dissolved.weeks.map((w: any) => w.phase)], [[], [null, null, null, null]]);
});

test("phases: a copied week stays in the phase; the last week of a phase takes it along", async () => {
  const { call } = setup();
  let program = (await call("POST", "/api/programs", { name: "Plan", start_date: "2026-08-31" })).json;
  program = (await call("POST", `/api/programs/${program.id}/weeks`, { phase: "Aufbau" })).json;
  program = (await call("POST", `/api/programs/${program.id}/weeks`, { copy_of: program.weeks[0].id })).json;
  assert.deepEqual([program.phases.length, program.weeks[1].phase_id === program.weeks[0].phase_id], [1, true]);
  program = (await call("DELETE", `/api/weeks/${program.weeks[0].id}`)).json;
  assert.equal(program.phases.length, 1);
  program = (await call("PATCH", `/api/weeks/${program.weeks[0].id}`, { phase: null })).json;
  assert.deepEqual([program.phases, program.weeks[0].phase_id], [[], null]);
});

test("programs: list with progress, archive, delete keeps the sessions; foreign ones are 404", async () => {
  const { call, as } = setup();
  const { program, a } = await plan(call);
  const other = (await call("POST", "/api/programs", { name: "Zweites", start_date: "2026-11-02" })).json;
  await call("PATCH", `/api/programs/${other.id}`, { archived: true });
  const list = (await call("GET", "/api/programs")).json;
  assert.deepEqual(list.map((p: any) => [p.name, p.archived, p.total]), [["Bankziehen", false, 2], ["Zweites", true, 0]]);
  const session = (await call("POST", `/api/planned-sessions/${a.id}/start`, {})).json;
  const stranger = as("ha-user-2");
  assert.equal((await stranger("GET", `/api/programs/${program.id}`)).status, 404);
  assert.equal((await stranger("POST", `/api/planned-sessions/${a.id}/start`, {})).status, 404);
  assert.equal((await stranger("PATCH", `/api/planned-items/${program.weeks[0].sessions[0].items[1].id}`, { rest: "x" })).status, 404);
  assert.deepEqual((await stranger("GET", "/api/programs")).json, []);
  assert.equal((await call("DELETE", `/api/programs/${program.id}`)).status, 204);
  const kept = (await call("GET", `/api/sessions/${session.id}`)).json;
  assert.equal(kept.plan, null);
  assert.equal(kept.blocks[0].exercises[0].planned, null);
});

test("exercises used by a plan cannot be deleted", async () => {
  const { call } = setup();
  const { b } = await plan(call);
  assert.equal((await call("DELETE", `/api/exercises/${b.id}`)).status, 409);
});

test("start: an archived exercise in the plan is refused, nothing is created", async () => {
  const { call } = setup();
  const { h, a } = await plan(call);
  await call("PATCH", `/api/exercises/${h.id}`, { archived: true });
  assert.equal((await call("POST", `/api/planned-sessions/${a.id}/start`, {})).status, 409);
  assert.deepEqual((await call("GET", "/api/sessions")).json, []);
});
