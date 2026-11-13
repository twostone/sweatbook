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

test("sharing: others see a shared program, join with their own start, progress and 1RM stay their own", async () => {
  const { call, as } = setup();
  const { b, program, a } = await plan(call);
  const ben = as("ha-user-2");

  // not shared yet: invisible and 404
  assert.deepEqual((await ben("GET", "/api/programs")).json, []);
  assert.equal((await ben("POST", `/api/programs/${program.id}/join`, { start_date: "2026-11-02" })).status, 404);

  assert.equal((await call("PATCH", `/api/programs/${program.id}`, { shared: true })).json.shared, true);
  const listed = (await ben("GET", "/api/programs")).json;
  assert.deepEqual(listed.map((p: any) => [p.name, p.joined, p.owned, p.done]), [["Bankziehen", false, false, 0]]);
  // listed is not joined: no access to the tree or the sessions yet
  assert.equal((await ben("GET", `/api/programs/${program.id}`)).status, 404);
  assert.equal((await ben("POST", `/api/planned-sessions/${a.id}/start`, {})).status, 404);

  const joined = (await ben("POST", `/api/programs/${program.id}/join`, { start_date: "2026-11-02" })).json;
  assert.equal(joined.start_date, "2026-11-02");
  assert.equal(joined.joined, true);
  assert.equal((await call("GET", `/api/programs/${program.id}`)).json.start_date, "2026-08-31");

  // Ben has no 1RM: the %-line has no weight; with his own it is computed from his value
  assert.equal(joined.weeks[0].sessions[0].items[1].weight_kg, null);
  await ben("POST", `/api/exercises/${b.id}/tests`, { kind: "one_rm", tested_on: "2026-10-01", weight_kg: 100 });
  assert.equal((await ben("GET", `/api/programs/${program.id}`)).json.weeks[0].sessions[0].items[1].weight_kg, 85);
  assert.equal((await call("GET", `/api/programs/${program.id}`)).json.weeks[0].sessions[0].items[1].weight_kg, 97.5);

  // his progress is his own
  const started = (await ben("POST", `/api/planned-sessions/${a.id}/start`, {})).json;
  await ben("POST", `/api/block-exercises/${started.blocks[0].exercises[0].id}/sets`, { sets: [{ reps: 3 }] });
  await ben("PATCH", `/api/planned-sessions/${program.weeks[0].sessions[1].id}`, { skipped: true });
  const benState = (await ben("GET", `/api/programs/${program.id}`)).json;
  const ownerState = (await call("GET", `/api/programs/${program.id}`)).json;
  assert.deepEqual(benState.weeks[0].sessions.map((s: any) => s.state), ["done", "skipped"]);
  assert.deepEqual(ownerState.weeks[0].sessions.map((s: any) => s.state), ["open", "open"]);
  assert.equal(ownerState.weeks[0].sessions[0].session_id, null);

  // members edit the plan; only the owner renames, shares, deletes
  assert.equal((await ben("PATCH", `/api/planned-items/${program.weeks[0].sessions[0].items[1].id}`, { rest: "2 Min" })).status, 200);
  assert.equal((await call("GET", `/api/programs/${program.id}`)).json.weeks[0].sessions[0].items[1].rest, "2 Min");
  assert.equal((await ben("PATCH", `/api/programs/${program.id}`, { name: "Meins" })).status, 403);
  assert.equal((await ben("PATCH", `/api/programs/${program.id}`, { shared: false })).status, 403);
  assert.equal((await ben("DELETE", `/api/programs/${program.id}`)).status, 403);
  assert.equal((await ben("PATCH", `/api/programs/${program.id}`, { archived: true })).json.archived, true);
  assert.equal((await call("GET", `/api/programs/${program.id}`)).json.archived, false);
  assert.equal((await call("DELETE", `/api/programs/${program.id}/membership`)).status, 403);
});

test("sharing: stopping it locks members out and keeps their sessions; sharing again revives them; leaving", async () => {
  const { call, as } = setup();
  const { program, a } = await plan(call);
  const ben = as("ha-user-2");
  await call("PATCH", `/api/programs/${program.id}`, { shared: true });
  await ben("POST", `/api/programs/${program.id}/join`, { start_date: "2026-11-02" });
  const session = (await ben("POST", `/api/planned-sessions/${a.id}/start`, {})).json;

  await call("PATCH", `/api/programs/${program.id}`, { shared: false });
  assert.equal((await ben("GET", `/api/programs/${program.id}`)).status, 404);
  assert.deepEqual((await ben("GET", "/api/programs")).json, []);
  assert.equal((await ben("GET", `/api/sessions/${session.id}`)).status, 200);

  await call("PATCH", `/api/programs/${program.id}`, { shared: true });
  assert.equal((await ben("GET", `/api/programs/${program.id}`)).json.start_date, "2026-11-02");

  assert.equal((await ben("DELETE", `/api/programs/${program.id}/membership`)).status, 204);
  assert.equal((await ben("GET", `/api/programs/${program.id}`)).status, 404);
  assert.equal((await ben("GET", `/api/sessions/${session.id}`)).status, 200);

  await call("DELETE", `/api/programs/${program.id}`);
  assert.equal((await ben("GET", `/api/sessions/${session.id}`)).json.plan, null);
});

// A program with one planned session; the lines are added by the tests.
async function sexPlan(call: Call) {
  const e = (await call("POST", "/api/exercises", { name: "Kettlebell Swing", fields: ["weight", "reps"] })).json;
  let program = (await call("POST", "/api/programs", { name: "P", start_date: "2026-08-31" })).json;
  program = (await call("POST", `/api/programs/${program.id}/weeks`, {})).json;
  program = (await call("POST", `/api/weeks/${program.weeks[0].id}/sessions`, { label: "A" })).json;
  const session = program.weeks[0].sessions[0];
  const add = (body: unknown) => call("POST", `/api/planned-sessions/${session.id}/items`, { exercise_id: e.id, sets: [3, 3], reps: [10, 10], ...(body as object) });
  return { e, program, session, add };
}

test("sex: a woman sees the women's weight, a user without a choice and a man the default; the line keeps both", async () => {
  const { as } = setup();
  const woman = as("ha-woman");
  const { program, session, add } = await sexPlan(woman);
  await woman("PATCH", "/api/me", { sex: "female" });
  await add({ load_kg: 24, load_kg_female: 16 });
  const both = (await add({ label: "nur Standard", load_kg: 20 })).json;
  const line = (p: any, i: number) => p.weeks[0].sessions[0].items[i];
  assert.deepEqual([line(both, 0).weight_kg, line(both, 0).load_kg, line(both, 0).load_kg_female], [16, 24, 16]);
  assert.equal(line(both, 1).weight_kg, 20);
  // the session started from the plan follows
  const started = (await woman("POST", `/api/planned-sessions/${session.id}/start`, {})).json;
  assert.deepEqual(started.blocks.map((b: any) => b.exercises[0].planned.weight_kg), [16, 20]);
  // other users of the same plan: default weight
  const man = as("ha-man");
  await woman("PATCH", `/api/programs/${program.id}`, { shared: true });
  await man("POST", `/api/programs/${program.id}/join`, { start_date: "2026-08-31" });
  assert.equal(line((await man("GET", `/api/programs/${program.id}`)).json, 0).weight_kg, 24);
  await man("PATCH", "/api/me", { sex: "male" });
  assert.equal(line((await man("GET", `/api/programs/${program.id}`)).json, 0).weight_kg, 24);
  await woman("PATCH", "/api/me", { sex: null });
  assert.equal(line((await woman("GET", `/api/programs/${program.id}`)).json, 0).weight_kg, 24);
});

test("sex: load_kg_female needs load_kg and excludes a percent load", async () => {
  const { call } = setup();
  const { e, add } = await sexPlan(call);
  assert.equal((await add({ load_kg_female: 16 })).status, 400);
  assert.equal((await add({ load_pct: 80, load_ref_exercise_id: e.id, load_kg_female: 16 })).status, 400);
  assert.equal((await add({ load_kg: 24, load_kg_female: 16 })).status, 201);
});

test("me: sex can be set and cleared, other values are refused", async () => {
  const { call } = setup();
  assert.equal((await call("GET", "/api/me")).json.sex, null);
  assert.equal((await call("PATCH", "/api/me", { sex: "female" })).json.sex, "female");
  assert.equal((await call("GET", "/api/me")).json.sex, "female");
  assert.equal((await call("PATCH", "/api/me", { sex: null })).json.sex, null);
  assert.equal((await call("PATCH", "/api/me", { sex: "x" })).status, 400);
  assert.equal((await call("PATCH", "/api/me", {})).status, 400);
});

test("sharing: joining with a start skips the earlier planned sessions for the joiner only", async () => {
  const { call, as } = setup();
  const { program } = await plan(call);
  const withWeek2 = (await call("POST", `/api/programs/${program.id}/weeks`, { copy_of: program.weeks[0].id })).json;
  const ids: string[] = withWeek2.weeks.flatMap((w: any) => w.sessions.map((s: any) => s.id)); // A1, B1, A2, B2
  assert.equal(ids.length, 4);
  const ben = as("ha-user-2");
  await call("PATCH", `/api/programs/${program.id}`, { shared: true });

  const offered = (await ben("GET", "/api/programs")).json[0];
  assert.deepEqual(offered.outline.map((e: any) => [e.week, e.label]), [[1, "A"], [1, "B"], [2, "A"], [2, "B"]]);
  assert.equal((await call("GET", "/api/programs")).json[0].outline, null);

  // an unknown id and a planned session of another program are 400, and nothing is joined
  const foreign = (await call("POST", "/api/programs", { name: "Anderes", start_date: "2026-08-31" })).json;
  const foreignWeek = (await call("POST", `/api/programs/${foreign.id}/weeks`, {})).json.weeks[0];
  const foreignSession = (await call("POST", `/api/weeks/${foreignWeek.id}/sessions`, { label: "X" })).json.weeks[0].sessions[0];
  for (const bad of ["00000000-0000-4000-8000-000000000000", foreignSession.id]) {
    assert.equal((await ben("POST", `/api/programs/${program.id}/join`, { start_date: "2026-11-02", start_planned_session_id: bad })).status, 400);
  }
  assert.equal((await ben("GET", `/api/programs/${program.id}`)).status, 404);

  const joined = (await ben("POST", `/api/programs/${program.id}/join`, { start_date: "2026-10-26", start_planned_session_id: ids[2] })).json;
  assert.deepEqual(joined.weeks.flatMap((w: any) => w.sessions.map((s: any) => s.state)), ["skipped", "skipped", "open", "open"]);
  assert.equal(joined.weeks[0].sessions[0].skip_note, "vor dem Beitritt");
  assert.equal(joined.next.planned_session_id, ids[2]);
  assert.equal(joined.outline, null);
  const owner = (await call("GET", `/api/programs/${program.id}`)).json;
  assert.deepEqual(owner.weeks.flatMap((w: any) => w.sessions.map((s: any) => s.state)), ["open", "open", "open", "open"]);

  // joining again changes nothing
  const again = (await ben("POST", `/api/programs/${program.id}/join`, { start_date: "2026-12-07", start_planned_session_id: ids[3] })).json;
  assert.equal(again.start_date, "2026-10-26");
  assert.equal(again.next.planned_session_id, ids[2]);
});

// What a copy must take over: phases, weeks and planned sessions with every value of their lines, but none of the ids.
const content = (p: any) => ({
  phases: p.phases.map((ph: any) => [ph.name, ph.note]),
  weeks: p.weeks.map((w: any) => ({
    number: w.number,
    phase: w.phase,
    deload: w.deload,
    sessions: w.sessions.map((s: any) => ({ label: s.label, items: s.items.map(({ id, ...item }: any) => item) })),
  })),
});
const ids = (p: any) => [p.id, ...p.phases.map((ph: any) => ph.id), ...p.weeks.flatMap((w: any) => [w.id, ...w.sessions.flatMap((s: any) => [s.id, ...s.items.map((i: any) => i.id)])])];

test("duplicate: the copy has every phase, week and line under new ids, starts open and names its source", async () => {
  const { call } = setup();
  const { program, a, bSession } = await plan(call);
  await call("PATCH", `/api/phases/${program.phases[0].id}`, { note: "schwer" });
  await call("POST", `/api/programs/${program.id}/weeks`, { copy_of: program.weeks[0].id, phase: null, deload: true });
  // progress in the original: A is done, B skipped
  const started = (await call("POST", `/api/planned-sessions/${a.id}/start`, {})).json;
  await call("POST", `/api/block-exercises/${started.blocks[0].exercises[0].id}/sets`, { sets: [{ weight_kg: 95, reps: 3 }] });
  await call("PATCH", `/api/planned-sessions/${bSession.id}`, { skipped: true });
  const original = (await call("GET", `/api/programs/${program.id}`)).json;
  assert.deepEqual(original.weeks[0].sessions.map((s: any) => s.state), ["done", "skipped"]);

  const res = await call("POST", `/api/programs/${program.id}/duplicate`, { name: "Bankziehen II", start_date: "2026-11-16" });
  assert.equal(res.status, 201);
  const copy = res.json;
  assert.deepEqual([copy.name, copy.start_date, copy.owned, copy.joined, copy.shared, copy.archived], ["Bankziehen II", "2026-11-16", true, true, false, false]);
  assert.deepEqual(copy.copied_from, { id: program.id, name: "Bankziehen", joined: true });
  assert.equal(original.copied_from, null);
  assert.deepEqual(content(copy), content(original));
  assert.deepEqual(content(copy).phases, [["Block 2 – Maximalkraft I", "schwer"]]);
  assert.deepEqual(copy.weeks.map((w: any) => [w.number, w.phase, w.deload, w.sessions.length]), [[1, "Block 2 – Maximalkraft I", false, 2], [2, null, true, 2]]);
  assert.equal(ids(copy).some((id) => ids(original).includes(id)), false);
  // nothing of the progress: every planned session is open, no session hangs on it
  assert.deepEqual(copy.weeks.flatMap((w: any) => w.sessions.map((s: any) => [s.state, s.session_id, s.skip_note])), Array(4).fill(["open", null, null]));
  assert.deepEqual([copy.done, copy.total, copy.next.week, copy.next.label], [0, 4, 1, "A"]);
  assert.deepEqual(copy.tests, original.tests); // test values belong to the user and the exercise, not to the program

  // the original is untouched, and stays so when the copy changes
  assert.deepEqual((await call("GET", `/api/programs/${program.id}`)).json, original);
  await call("PATCH", `/api/planned-items/${copy.weeks[0].sessions[0].items[1].id}`, { rest: "5 Min" });
  await call("POST", `/api/programs/${copy.id}/weeks`, {});
  await call("PATCH", `/api/phases/${copy.phases[0].id}`, { name: "Umgebaut" });
  await call("DELETE", `/api/planned-sessions/${copy.weeks[0].sessions[1].id}`);
  assert.deepEqual((await call("GET", `/api/programs/${program.id}`)).json, original);
  assert.deepEqual((await call("GET", "/api/programs")).json.map((p: any) => p.name).sort(), ["Bankziehen", "Bankziehen II"]);
});

test("duplicate: archive_source archives the original for the user only; a deleted original leaves the copy without a source", async () => {
  const { call, as } = setup();
  const { program } = await plan(call);
  const ben = as("ha-user-2");
  await call("PATCH", `/api/programs/${program.id}`, { shared: true });
  await ben("POST", `/api/programs/${program.id}/join`, { start_date: "2026-11-02" });

  const copy = (await ben("POST", `/api/programs/${program.id}/duplicate`, { name: "Bens Variante", start_date: "2026-11-09", archive_source: true })).json;
  assert.deepEqual([copy.owned, copy.shared, copy.copied_from.name], [true, false, "Bankziehen"]);
  assert.equal((await ben("GET", `/api/programs/${program.id}`)).json.archived, true);
  assert.equal((await call("GET", `/api/programs/${program.id}`)).json.archived, false);
  // the owner of the original neither sees the copy nor may read it
  assert.deepEqual((await call("GET", "/api/programs")).json.map((p: any) => p.name), ["Bankziehen"]);
  assert.equal((await call("GET", `/api/programs/${copy.id}`)).status, 404);
  assert.equal((await call("POST", `/api/programs/${copy.id}/duplicate`, { name: "X", start_date: "2026-11-09" })).status, 404);

  // no longer shared: the copy stays, but must not name somebody's private program
  await call("PATCH", `/api/programs/${program.id}`, { shared: false });
  assert.equal((await ben("GET", `/api/programs/${copy.id}`)).json.copied_from, null);
  await call("PATCH", `/api/programs/${program.id}`, { shared: true });
  assert.equal((await ben("GET", `/api/programs/${copy.id}`)).json.copied_from.id, program.id);
  assert.equal((await call("DELETE", `/api/programs/${program.id}`)).status, 204);
  const left = (await ben("GET", `/api/programs/${copy.id}`)).json;
  assert.deepEqual([left.copied_from, left.weeks[0].sessions[0].items.length], [null, 4]);
});

test("duplicate: whoever may read a program may copy it, joined or not; everything else is a 404", async () => {
  const { call, as } = setup();
  const { program } = await plan(call);
  const ben = as("ha-user-2");
  const body = { name: "Kopie", start_date: "2026-11-09" };
  assert.equal((await ben("POST", `/api/programs/${program.id}/duplicate`, body)).status, 404); // not shared
  assert.equal((await call("POST", "/api/programs/00000000-0000-4000-8000-000000000000/duplicate", body)).status, 404);

  await call("PATCH", `/api/programs/${program.id}`, { shared: true });
  // without joining, and archive_source has nothing to archive
  const copy = (await ben("POST", `/api/programs/${program.id}/duplicate`, { ...body, archive_source: true })).json;
  assert.deepEqual([copy.owned, copy.joined, copy.weeks[0].sessions[0].items.length], [true, true, 4]);
  assert.deepEqual(copy.copied_from, { id: program.id, name: "Bankziehen", joined: false }); // listed for him, but no page to open
  const listed = (await ben("GET", "/api/programs")).json;
  assert.deepEqual(listed.map((p: any) => [p.name, p.joined, p.archived]), [["Kopie", true, false], ["Bankziehen", false, false]]);
  assert.equal((await ben("POST", `/api/programs/${program.id}/duplicate`, { name: " ", start_date: "2026-11-09" })).status, 400);
  assert.equal((await ben("POST", `/api/programs/${program.id}/duplicate`, { name: "K" })).status, 400);

  // a member locked out of a program no longer shared cannot copy it any more
  await ben("POST", `/api/programs/${program.id}/join`, { start_date: "2026-11-02" });
  await call("PATCH", `/api/programs/${program.id}`, { shared: false });
  assert.equal((await ben("POST", `/api/programs/${program.id}/duplicate`, body)).status, 404);
  assert.equal((await call("POST", `/api/programs/${program.id}/duplicate`, body)).status, 201);
});

// Three weeks with A and B each, one line per planned session; `train` logs a set on a planned session.
async function longPlan(call: Call) {
  const b = (await call("GET", "/api/exercises?q=Bankziehen")).json[0] ?? (await call("POST", "/api/exercises", bench)).json;
  let program = (await call("POST", "/api/programs", { name: "Zyklus", start_date: "2026-08-31" })).json;
  for (let n = 0; n < 3; n++) {
    program = (await call("POST", `/api/programs/${program.id}/weeks`, {})).json;
    for (const label of ["A", "B"]) {
      program = (await call("POST", `/api/weeks/${program.weeks[n].id}/sessions`, { label })).json;
      const planned = program.weeks[n].sessions.at(-1);
      program = (await call("POST", `/api/planned-sessions/${planned.id}/items`, { exercise_id: b.id, sets: [3, 3], reps: [5, 5], load_kg: 80 })).json;
    }
  }
  return program;
}
async function train(call: Call, plannedId: string, startedAt: string) {
  const session = (await call("POST", `/api/planned-sessions/${plannedId}/start`, { started_at: startedAt, ended_at: startedAt })).json;
  await call("POST", `/api/block-exercises/${session.blocks[0].exercises[0].id}/sets`, { sets: [{ weight_kg: 80, reps: 5 }] });
  return session;
}
const units = (p: any) => p.weeks.flatMap((w: any) => w.sessions);
const states = (p: any) => units(p).map((s: any) => s.state);
const fork = async (call: Call, program: any, index: number, name = "Fork") =>
  (await call("POST", `/api/programs/${program.id}/duplicate`, { name, start_date: "2026-08-31", start_planned_session_id: units(program)[index].id })).json;

test("fork: before the entry point training is inherited and the rest skipped, from there on everything is open", async () => {
  const { call } = setup();
  const program = await longPlan(call);
  const [a1, b1, a2, b2, a3] = units(program);
  const trained = await train(call, a1.id, "2026-09-01T10:00:00Z");
  await call("PATCH", `/api/planned-sessions/${b1.id}`, { skipped: true, skip_note: "krank" });
  await call("PATCH", `/api/planned-sessions/${a2.id}`, { skipped: true });
  await train(call, a3.id, "2026-09-15T10:00:00Z"); // out of order, after the entry point
  // b2 stays open in the original

  const copy = (await call("POST", `/api/programs/${program.id}/duplicate`, { name: "Fork", start_date: "2026-08-31", start_planned_session_id: a3.id, archive_source: true })).json;
  assert.deepEqual(states(copy), ["done", "skipped", "skipped", "skipped", "open", "open"]);
  assert.deepEqual(units(copy).map((s: any) => s.skip_note), [null, "krank", "vor der Kopie", "vor der Kopie", null, null]);
  assert.deepEqual(units(copy).map((s: any) => s.session_id), [trained.id, null, null, null, null, null]);
  assert.deepEqual([copy.done, copy.total, copy.next.week, copy.next.label], [4, 6, 3, "A"]);
  assert.equal(units(copy).some((s: any) => units(program).some((o: any) => o.id === s.id)), false);
  // the training stays where it was
  assert.equal((await call("GET", `/api/sessions/${trained.id}`)).json.plan.program_id, program.id);

  // a snapshot: later training in the original, before and after the point, does not reach the copy
  await train(call, b2.id, "2026-09-20T10:00:00Z");
  await train(call, units(program)[5].id, "2026-09-21T10:00:00Z");
  const original = (await call("GET", `/api/programs/${program.id}`)).json;
  assert.deepEqual(states(original), ["done", "skipped", "skipped", "done", "done", "done"]);
  assert.equal(original.archived, true);
  assert.deepEqual(states((await call("GET", `/api/programs/${copy.id}`)).json), ["done", "skipped", "skipped", "skipped", "open", "open"]);

  // training in the copy is its own
  await train(call, units(copy)[4].id, "2026-09-22T10:00:00Z");
  assert.deepEqual(states((await call("GET", `/api/programs/${copy.id}`)).json), ["done", "skipped", "skipped", "skipped", "done", "open"]);
});

test("fork: the entry point must be a planned session of the source; without training of one's own everything before is skipped", async () => {
  const { call, as } = setup();
  const program = await longPlan(call);
  const other = await longPlan(call);
  const body = { name: "Fork", start_date: "2026-08-31" };
  assert.equal((await call("POST", `/api/programs/${program.id}/duplicate`, { ...body, start_planned_session_id: units(other)[2].id })).status, 400);
  assert.equal((await call("POST", `/api/programs/${program.id}/duplicate`, { ...body, start_planned_session_id: "nope" })).status, 400);
  assert.equal((await call("GET", "/api/programs")).json.length, 2); // nothing was created

  await train(call, units(program)[0].id, "2026-09-01T10:00:00Z");
  await call("PATCH", `/api/programs/${program.id}`, { shared: true });
  const ben = as("ha-user-2");
  const copy = await fork(ben, program, 2);
  assert.deepEqual(states(copy), ["skipped", "skipped", "open", "open", "open", "open"]); // the owner's training is not his
  assert.deepEqual(units(copy).slice(0, 2).map((s: any) => [s.skip_note, s.session_id]), [["vor der Kopie", null], ["vor der Kopie", null]]);
  // the first planned session as entry point is a plain copy
  assert.deepEqual(states(await fork(call, program, 0, "Von vorn")), Array(6).fill("open"));
});

test("fork: a copy of a copy keeps the inherited training", async () => {
  const { call } = setup();
  const program = await longPlan(call);
  const trained = await train(call, units(program)[0].id, "2026-09-01T10:00:00Z");
  const first = await fork(call, program, 2, "Fork 1");
  await train(call, units(first)[2].id, "2026-09-08T10:00:00Z");
  const second = await fork(call, first, 4, "Fork 2");
  assert.deepEqual(states(second), ["done", "skipped", "done", "skipped", "open", "open"]);
  assert.equal(units(second)[0].session_id, trained.id);
  // the middle copy can go: the first inheritance points at the original, the second moves over
  assert.equal((await call("DELETE", `/api/programs/${first.id}`)).status, 204);
  assert.deepEqual(states((await call("GET", `/api/programs/${second.id}`)).json), ["done", "skipped", "done", "skipped", "open", "open"]);
});

test("delete session: the planned session opens again, or is skipped when copies inherited it; the choice overrides", async () => {
  const { call } = setup();
  const program = await longPlan(call);
  const [a1, b1, a2] = units(program);
  const s1 = await train(call, a1.id, "2026-09-01T10:00:00Z");
  const s2 = await train(call, b1.id, "2026-09-03T10:00:00Z");
  const s3 = await train(call, a2.id, "2026-09-08T10:00:00Z");
  const free = (await call("POST", "/api/sessions", { started_at: "2026-09-09T10:00:00Z", ended_at: "2026-09-09T10:00:00Z" })).json;
  assert.equal(free.plan, null);
  // no copy: the question defaults to "open", as deleting always behaved
  assert.deepEqual(s1.plan.deletion, null); // no sets yet when it was started
  assert.deepEqual((await call("GET", `/api/sessions/${s1.id}`)).json.plan.deletion, { default: "open", copies: 0 });
  assert.equal((await call("DELETE", `/api/sessions/${s3.id}?planned=nope`)).status, 400);
  assert.equal((await call("DELETE", `/api/sessions/${s3.id}`)).status, 204);
  assert.deepEqual(states((await call("GET", `/api/programs/${program.id}`)).json).slice(0, 3), ["done", "done", "open"]);

  const copy = await fork(call, program, 3);
  assert.deepEqual(states(copy), ["done", "done", "skipped", "open", "open", "open"]);
  assert.deepEqual((await call("GET", `/api/sessions/${s1.id}`)).json.plan.deletion, { default: "skipped", copies: 1 });

  // without a choice: skipped everywhere, so the copy does not propose training from before the fork
  assert.equal((await call("DELETE", `/api/sessions/${s1.id}`)).status, 204);
  const original = (await call("GET", `/api/programs/${program.id}`)).json;
  const after = (await call("GET", `/api/programs/${copy.id}`)).json;
  assert.deepEqual([units(original)[0].state, units(original)[0].skip_note], ["skipped", "Training gelöscht"]);
  assert.deepEqual([units(after)[0].state, units(after)[0].skip_note, after.next.week, after.next.label], ["skipped", "vor der Kopie", 2, "B"]);

  // "open" asks for training again, in the original and in the copy
  assert.equal((await call("DELETE", `/api/sessions/${s2.id}?planned=open`)).status, 204);
  assert.equal(units((await call("GET", `/api/programs/${program.id}`)).json)[1].state, "open");
  const reopened = (await call("GET", `/api/programs/${copy.id}`)).json;
  assert.deepEqual([units(reopened)[1].state, reopened.next.week, reopened.next.label], ["open", 1, "B"]);
});

test("delete session: skipped on request without copies; nothing changes while another session keeps the planned session done", async () => {
  const { call } = setup();
  const program = await longPlan(call);
  const [a1, b1] = units(program);
  const first = await train(call, a1.id, "2026-09-01T10:00:00Z");
  const second = await train(call, a1.id, "2026-09-02T10:00:00Z");
  assert.equal((await call("GET", `/api/sessions/${first.id}`)).json.plan.deletion, null); // the second one keeps it done
  await call("DELETE", `/api/sessions/${first.id}?planned=skipped`);
  const kept = units((await call("GET", `/api/programs/${program.id}`)).json)[0];
  assert.deepEqual([kept.state, kept.skip_note, kept.session_id], ["done", null, second.id]);

  const only = await train(call, b1.id, "2026-09-03T10:00:00Z");
  await call("DELETE", `/api/sessions/${only.id}?planned=skipped`);
  const skipped = units((await call("GET", `/api/programs/${program.id}`)).json)[1];
  assert.deepEqual([skipped.state, skipped.skip_note], ["skipped", "Training gelöscht"]);
  // a session started from the plan but without sets asks nothing
  const empty = (await call("POST", `/api/planned-sessions/${units(program)[2].id}/start`, {})).json;
  assert.equal(empty.plan.deletion, null);
});

test("hand over: deleting the original, a week or a planned session moves inherited training into the copy", async () => {
  const { call, as } = setup();
  const program = await longPlan(call);
  const [a1, b1, a2] = units(program);
  const ben = as("ha-user-2");
  await call("PATCH", `/api/programs/${program.id}`, { shared: true });
  await ben("POST", `/api/programs/${program.id}/join`, { start_date: "2026-08-31" });
  const s1 = await train(call, a1.id, "2026-09-01T10:00:00Z");
  const s2 = await train(call, b1.id, "2026-09-03T10:00:00Z");
  const s3 = await train(call, a2.id, "2026-09-08T10:00:00Z");
  const benS1 = await train(ben, a1.id, "2026-09-01T18:00:00Z");
  const benS3 = await train(ben, a2.id, "2026-09-08T18:00:00Z");
  const copy = await fork(call, program, 3, "Fork 1");
  const twin = await fork(call, program, 3, "Fork 2");
  const benCopy = await fork(ben, program, 2, "Bens Fork"); // A2 is not inherited: his entry point
  const done3 = ["done", "done", "done", "open", "open", "open"];
  assert.deepEqual([states(copy), states(twin), states(benCopy)], [done3, done3, ["done", "skipped", "open", "open", "open", "open"]]);

  // one planned session: the training moves to the oldest copy, the other copy follows it there
  assert.equal((await call("DELETE", `/api/planned-sessions/${a1.id}`)).status, 200);
  const moved = (await call("GET", `/api/sessions/${s1.id}`)).json;
  assert.deepEqual([moved.plan.program_id, moved.plan.planned_session_id, moved.blocks[0].exercises[0].planned], [copy.id, units(copy)[0].id, null]);
  assert.equal(moved.blocks[0].exercises[0].sets.length, 1);
  assert.equal((await ben("GET", `/api/sessions/${benS1.id}`)).json.plan.program_id, benCopy.id);
  const read = async (c: Call, p: any) => states((await c("GET", `/api/programs/${p.id}`)).json);
  assert.deepEqual([await read(call, copy), await read(call, twin), await read(ben, benCopy)], [done3, done3, ["done", "skipped", "open", "open", "open", "open"]]);

  // a week, then the whole program
  const week2 = (await call("GET", `/api/programs/${program.id}`)).json.weeks[1];
  assert.equal((await call("DELETE", `/api/weeks/${week2.id}`)).status, 200);
  assert.equal((await call("GET", `/api/sessions/${s3.id}`)).json.plan.program_id, copy.id);
  assert.equal((await ben("GET", `/api/sessions/${benS3.id}`)).json.plan, null); // nobody inherited his: only the link goes
  assert.equal((await call("DELETE", `/api/programs/${program.id}`)).status, 204);
  assert.equal((await call("GET", `/api/sessions/${s2.id}`)).json.plan.program_id, copy.id);
  assert.deepEqual([await read(call, copy), await read(call, twin), await read(ben, benCopy)], [done3, done3, ["done", "skipped", "open", "open", "open", "open"]]);
  // the sessions are all still there
  assert.equal((await call("GET", "/api/sessions")).json.length, 3);
  assert.equal((await ben("GET", "/api/sessions")).json.length, 2);
});

test("missing 1RM: open percent lines without a weight name their reference exercise, once", async () => {
  const { call, as } = setup();
  const { b, h, program, a } = await plan(call);
  // the owner has a 1RM for Bankziehen: nothing is missing
  assert.deepEqual(program.missing_one_rms, []);
  // a second percent line on the same exercise, one on another, and lines that never count
  await call("POST", `/api/planned-sessions/${a.id}/items`, { exercise_id: b.id, sets: [3, 3], load_pct: 70, load_ref_exercise_id: b.id });
  await call("POST", `/api/planned-sessions/${a.id}/items`, { exercise_id: h.id, sets: [1, 1], load_pct: 50, load_ref_exercise_id: h.id });
  assert.deepEqual((await call("GET", `/api/programs/${program.id}`)).json.missing_one_rms.map((e: any) => e.name), ["Dead Hang"]);
  await call("POST", `/api/exercises/${h.id}/tests`, { kind: "one_rm", tested_on: "2026-09-01", weight_kg: 20 });
  assert.deepEqual((await call("GET", `/api/programs/${program.id}`)).json.missing_one_rms, []);

  // somebody else has none of his own, and the list shrinks as the percent lines stop mattering
  await call("PATCH", `/api/programs/${program.id}`, { shared: true });
  const ben = as("ha-user-2");
  const joined = (await ben("POST", `/api/programs/${program.id}/join`, { start_date: "2026-11-02" })).json;
  assert.deepEqual(joined.missing_one_rms.map((e: any) => e.name), ["Bankziehen", "Dead Hang"]);
  await ben("PATCH", `/api/planned-sessions/${a.id}`, { skipped: true });
  assert.deepEqual((await ben("GET", `/api/programs/${program.id}`)).json.missing_one_rms, []);
  await ben("PATCH", `/api/planned-sessions/${a.id}`, { skipped: false });
  await ben("POST", `/api/exercises/${b.id}/tests`, { kind: "one_rm", tested_on: "2026-10-01", weight_kg: 100 });
  assert.deepEqual((await ben("GET", `/api/programs/${program.id}`)).json.missing_one_rms.map((e: any) => e.name), ["Dead Hang"]);
});
