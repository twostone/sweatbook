import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { createToken, listTokens, resolveToken, revokeToken } from "../src/data/tokens.ts";
import { resolveUser } from "../src/data/users.ts";
import { NotFoundError } from "../src/data/common.ts";

const INGRESS = "172.30.32.2";
const outsider = { incoming: { socket: { remoteAddress: "192.168.1.10" } } };

function setup() {
  const db = openDb(":memory:");
  const app = createApp(db, { allowedIp: INGRESS, mcpEnabled: true });
  const anna = resolveUser(db, "ha-anna", null).id;
  const ben = resolveUser(db, "ha-ben", null).id;
  const rpc = async (token: string | null, method: string, params: unknown = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await app.request("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }, outsider);
    const body = await res.text();
    return { status: res.status, json: body ? JSON.parse(body) : null };
  };
  const call = async (token: string, name: string, args: unknown = {}) => {
    const { json } = await rpc(token, "tools/call", { name, arguments: args });
    const result = json.result ?? { isError: true, content: [{ text: JSON.stringify(json.error) }] };
    // Tool errors are JSON; what the SDK refuses before the tool runs (unknown tool, invalid arguments) is plain text.
    const raw: string = result.content[0].text;
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { error: raw };
    }
    return { isError: !!result.isError, data };
  };
  return { db, app, anna, ben, rpc, call };
}

test("tokens: only a hash is stored, the token resolves to its user and scope, revoking removes it", () => {
  const { db, anna, ben } = setup();
  const { token, info } = createToken(db, anna, { name: "  Claude  ", scope: "read" });
  assert.match(token, /^sb_/);
  assert.equal(info.name, "Claude");
  assert.equal(db.prepare("SELECT count(*) AS n FROM api_token WHERE token_hash = ?").get(token)?.n, 0);
  assert.deepEqual(resolveToken(db, token), { user_id: anna, scope: "read" });
  assert.equal(resolveToken(db, token + "x"), null);
  assert.equal(resolveToken(db, "nope"), null);
  assert.throws(() => revokeToken(db, ben, info.id), NotFoundError);
  assert.equal(listTokens(db, ben).length, 0);
  revokeToken(db, anna, info.id);
  assert.equal(resolveToken(db, token), null);
});

test("tokens: last_used_at is set on use and not rewritten within a minute", () => {
  const { db, anna } = setup();
  const { token, info } = createToken(db, anna, { name: "a", scope: "read" });
  resolveToken(db, token, new Date("2026-10-30T10:00:00Z"));
  resolveToken(db, token, new Date("2026-10-30T10:00:30Z"));
  assert.equal(listTokens(db, anna)[0]!.last_used_at, "2026-10-30T10:00:00.000Z");
  resolveToken(db, token, new Date("2026-10-30T10:01:00Z"));
  assert.equal(listTokens(db, anna).find((t) => t.id === info.id)!.last_used_at, "2026-10-30T10:01:00.000Z");
});

test("token api: managed through ingress, plain token only in the creation response", async () => {
  const { app } = setup();
  const ingress = { incoming: { socket: { remoteAddress: INGRESS } } };
  const headers = { "X-Remote-User-Id": "ha-anna", "Content-Type": "application/json" };
  const created = await app.request("/api/tokens", { method: "POST", headers, body: JSON.stringify({ name: "Laptop", scope: "write" }) }, ingress);
  assert.equal(created.status, 201);
  const { token, info } = (await created.json()) as { token: string; info: { id: string } };
  assert.match(token, /^sb_/);
  const list = await (await app.request("/api/tokens", { headers }, ingress)).text();
  assert.ok(!list.includes(token));
  assert.equal((await app.request(`/api/tokens/${info.id}`, { method: "DELETE", headers }, ingress)).status, 204);
  // the token API stays behind the guard
  assert.equal((await app.request("/api/tokens", { headers }, outsider)).status, 403);
});

test("mcp: no or wrong token is 401, a short burst of wrong ones is throttled", async () => {
  const { rpc } = setup();
  assert.equal((await rpc(null, "tools/list")).status, 401);
  assert.equal((await rpc("sb_wrong", "tools/list")).status, 401);
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await rpc("sb_wrong", "tools/list")).status;
  assert.equal(last, 429);
});

test("mcp: off by default, and /api stays behind the guard", async () => {
  const app = createApp(openDb(":memory:"), { allowedIp: INGRESS });
  assert.equal((await app.request("/mcp", { method: "POST" }, outsider)).status, 404);
  assert.equal((await app.request("/api/me", { headers: { "X-Remote-User-Id": "x" } }, outsider)).status, 403);
});

test("mcp: a read token sees only read tools, a write token all", async () => {
  const { db, anna, rpc } = setup();
  const read = createToken(db, anna, { name: "r", scope: "read" }).token;
  const write = createToken(db, anna, { name: "w", scope: "write" }).token;
  const names = async (t: string) => ((await rpc(t, "tools/list")).json.result.tools as { name: string }[]).map((x) => x.name);
  const readNames = await names(read);
  const writeNames = await names(write);
  assert.ok(readNames.includes("list_sessions") && !readNames.includes("add_sets"));
  assert.ok(writeNames.includes("add_sets") && writeNames.length > readNames.length);
});

test("mcp: tools act as the token's user, exercises by name, answers are compact views", async () => {
  const { db, anna, ben, call } = setup();
  const a = createToken(db, anna, { name: "a", scope: "write" }).token;
  const b = createToken(db, ben, { name: "b", scope: "write" }).token;

  const exercise = (await call(a, "create_exercise", { name: "Kniebeuge", fields: ["weight", "reps"], aliases: ["Squat"] })).data;
  assert.equal((await call(a, "create_exercise", { name: "kniebeuge", fields: ["reps"] })).isError, true);

  const logged = (await call(a, "log_sets", { exercise: "squat", sets: [{ count: 3, reps: 5, weight_kg: 100 }, { reps: 4, weight_kg: 100 }] })).data;
  assert.equal(logged.open, true);
  assert.equal(logged.exercises[0].name, "Kniebeuge");
  assert.equal(logged.exercises[0].summary, "3×5 @ 100 kg, 1×4 @ 100 kg");
  assert.equal(logged.exercises[0].sets.length, 4);
  assert.equal((await call(a, "get_session", { session_id: logged.id })).data.exercises[0].sets.length, 4);
  assert.equal((await call(a, "get_exercise", { exercise: exercise.id })).data.name, "Kniebeuge");

  const today = (await call(a, "get_today")).data;
  assert.equal(today.open_session.id, logged.id);
  assert.deepEqual(today.next_workouts, []);

  // another user's training is simply not found, and so are their sets in the evaluations
  const foreign = await call(b, "get_session", { session_id: logged.id });
  assert.equal(foreign.isError, true);
  assert.match(foreign.data.error, /not found/);
  assert.equal((await call(b, "list_sessions")).data.sessions.length, 0);
  assert.equal((await call(b, "get_exercise_progress", { exercise: "Kniebeuge" })).data.sessions.length, 0);
  assert.equal((await call(a, "get_exercise_progress", { exercise: "Kniebeuge" })).data.sessions.length, 1);
  assert.equal((await call(a, "get_training_summary", { weeks: 2 })).data.weeks.length, 2);

  // refused input comes back as a tool error that says what to do
  const unknown = await call(a, "log_sets", { exercise: "Kniebeu", sets: [{ reps: 5 }] });
  assert.equal(unknown.isError, true);
  assert.match(unknown.data.error, /similar: Kniebeuge/);
  assert.equal((await call(a, "get_session", { session_id: "nope" })).isError, true);
  assert.equal((await call(a, "log_sets", { exercise: "Kniebeuge", sets: [{ count: 20, reps: 5 }, { reps: 5 }] })).isError, true);
});

test("mcp: a read token cannot call a write tool", async () => {
  const { db, anna, call } = setup();
  const read = createToken(db, anna, { name: "r", scope: "read" }).token;
  assert.equal((await call(read, "create_exercise", { name: "X", fields: ["reps"] })).isError, true);
});

test("mcp: only the owner may delete a program (403 as tool error)", async () => {
  const { db, anna, ben, call } = setup();
  const a = createToken(db, anna, { name: "a", scope: "write" }).token;
  const b = createToken(db, ben, { name: "b", scope: "write" }).token;
  const program = (await call(a, "create_program", { name: "Plan", start_date: "2026-11-02" })).data;
  await call(a, "update_program", { program_id: program.id, shared: true });
  await call(b, "join_program", { program_id: program.id, start_date: "2026-11-09" });
  const denied = await call(b, "delete_program", { program_id: program.id });
  assert.equal(denied.isError, true);
});

test("mcp resources: joined programs are listed and readable, a read token may read them, others get nothing", async () => {
  const { db, anna, ben, rpc, call } = setup();
  const a = createToken(db, anna, { name: "a", scope: "write" }).token;
  const aRead = createToken(db, anna, { name: "ar", scope: "read" }).token;
  const b = createToken(db, ben, { name: "b", scope: "write" }).token;
  const program = (await call(a, "create_program", { name: "Plan", start_date: "2026-11-02" })).data;

  const listed = (await rpc(aRead, "resources/list")).json.result.resources as { uri: string; name: string }[];
  assert.deepEqual(listed.map((r) => [r.uri, r.name]), [[`sweatbook://programs/${program.id}`, "Plan"]]);
  const read = (await rpc(aRead, "resources/read", { uri: listed[0]!.uri })).json.result.contents[0];
  assert.equal(read.mimeType, "application/json");
  assert.equal(JSON.parse(read.text).id, program.id);

  assert.equal((await rpc(b, "resources/list")).json.result.resources.length, 0);
  assert.ok((await rpc(b, "resources/read", { uri: listed[0]!.uri })).json.error);
  // shared but not joined: still not readable, and not listed
  await call(a, "update_program", { program_id: program.id, shared: true });
  assert.equal((await rpc(b, "resources/list")).json.result.resources.length, 0);
  assert.ok((await rpc(b, "resources/read", { uri: listed[0]!.uri })).json.error);
  await call(b, "join_program", { program_id: program.id, start_date: "2026-11-09" });
  assert.equal((await rpc(b, "resources/list")).json.result.resources.length, 1);
});

test("mcp: every tool declares an output schema and described inputs; program views read like text", async () => {
  const { db, anna, rpc, call } = setup();
  const t = createToken(db, anna, { name: "w", scope: "write" }).token;
  const tools = (await rpc(t, "tools/list")).json.result.tools as { name: string; inputSchema: any; outputSchema?: any }[];
  assert.ok(tools.length > 40);
  for (const tool of tools) {
    assert.ok(tool.outputSchema, `${tool.name} has no outputSchema`);
    for (const [key, prop] of Object.entries<any>(tool.inputSchema.properties ?? {})) {
      assert.ok(prop.description || key === "count", `${tool.name}.${key} has no description`);
    }
  }

  await call(t, "create_exercise", { name: "Kniebeuge", fields: ["weight", "reps"], aliases: ["Squat"] });
  const program = (await call(t, "create_program", { name: "Plan", start_date: "2026-11-02" })).data;
  const week = (await call(t, "add_week", { program_id: program.id, phase: "Aufbau" })).data.weeks[0];
  const withSession = (await call(t, "add_planned_session", { week_id: week.id, label: "A" })).data;
  const plannedId = withSession.weeks[0].sessions[0].id;
  await call(t, "create_test", { exercise: "squat", kind: "one_rm", weight_kg: 140, tested_on: "2026-10-01" });
  const line = (await call(t, "add_plan_item", { planned_session_id: plannedId, exercise: "Kniebeuge", sets: 3, reps: [5, 8], load_pct: 70, load_ref_exercise: "Kniebeuge", rest: "2 min" })).data;
  assert.equal(line.weeks[0].sessions[0].rows[0].text, "3×5–8 @ 97.5 kg (70 % of Kniebeuge); rest 2 min");
  assert.equal(line.tests[0].text, "1RM 140 kg");
  await call(t, "add_plan_item", { planned_session_id: plannedId, note: "Aufwärmen 10 min" });
  const rows = (await call(t, "get_program", { program_id: program.id })).data.weeks[0].sessions[0].rows;
  assert.deepEqual([rows[1].exercise, rows[1].text], [null, "Aufwärmen 10 min"]);

  const started = (await call(t, "start_planned_session", { planned_session_id: plannedId })).data;
  assert.equal(started.plan.label, "A");
  assert.equal(started.exercises[0].planned, "3×5–8 @ 97.5 kg (70 % of Kniebeuge); rest 2 min");
  const today = (await call(t, "get_today")).data;
  assert.equal(today.open_session.id, started.id);
  const bad = await call(t, "add_plan_item", { planned_session_id: plannedId, exercise: "Kniebeuge", reps: [8, 5] });
  assert.equal(bad.isError, true);
});

test("mcp prompts: listed for every token, arguments end up in the text", async () => {
  const { db, anna, rpc } = setup();
  const read = createToken(db, anna, { name: "r", scope: "read" }).token;
  const names = ((await rpc(read, "prompts/list")).json.result.prompts as { name: string }[]).map((p) => p.name).sort();
  assert.deepEqual(names, ["adjust_plan", "analyze_training", "suggest_next_workout"]);
  const analysis = (await rpc(read, "prompts/get", { name: "analyze_training", arguments: { weeks: "8" } })).json.result.messages[0].content.text;
  assert.match(analysis, /last 8 weeks/);
  assert.match(analysis, /get_training_summary/);
  const adjust = (await rpc(read, "prompts/get", { name: "adjust_plan", arguments: { request: "Woche 3 leichter" } })).json.result.messages[0].content.text;
  assert.match(adjust, /Woche 3 leichter/);
});

test("mcp: join_program with start_week and start_label skips the earlier planned sessions", async () => {
  const { db, anna, ben, call } = setup();
  const a = createToken(db, anna, { name: "a", scope: "write" }).token;
  const b = createToken(db, ben, { name: "b", scope: "write" }).token;
  let program = (await call(a, "create_program", { name: "Plan", start_date: "2026-11-02" })).data;
  for (let n = 1; n <= 2; n++) {
    program = (await call(a, "add_week", { program_id: program.id })).data;
    const week = program.weeks[n - 1];
    await call(a, "add_planned_session", { week_id: week.id, label: "A" });
    await call(a, "add_planned_session", { week_id: week.id, label: "B" });
  }
  await call(a, "update_program", { program_id: program.id, shared: true });
  const listed = await call(b, "list_programs");
  const offered = listed.data.programs[0];
  assert.deepEqual(offered.outline.map((e: any) => [e.week, e.label]), [[1, "A"], [1, "B"], [2, "A"], [2, "B"]]);

  const missing = await call(b, "join_program", { program_id: program.id, start_date: "2026-10-26", start_week: 2, start_label: "C" });
  assert.equal(missing.isError, true);
  assert.equal((await call(b, "join_program", { program_id: program.id, start_date: "2026-10-26", start_label: "A" })).isError, true);

  const joined = (await call(b, "join_program", { program_id: program.id, start_date: "2026-10-26", start_week: 2, start_label: "b" })).data;
  assert.deepEqual(joined.weeks.flatMap((w: any) => w.sessions.map((s: any) => s.state)), ["skipped", "skipped", "skipped", "open"]);
  assert.deepEqual([joined.next.week, joined.next.label], [2, "B"]);
});
