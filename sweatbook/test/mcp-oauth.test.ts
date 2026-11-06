import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type AppOptions } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { createHaTokenVerifier } from "../src/auth/ha-token.ts";
import { createToken } from "../src/data/tokens.ts";
import { resolveUser } from "../src/data/users.ts";
import { fakeHa, jwt } from "./ha-auth-helpers.ts";

const INGRESS = "172.30.32.2";
const APP = "https://sweatbook.example.test";
const HA = "https://ha.example.test";
const outsider = { incoming: { socket: { remoteAddress: "192.168.1.10" } } };
const annaToken = jwt();

function setup(opts: { down?: boolean; oauth?: boolean } = {}) {
  const db = openDb(":memory:");
  const ha = fakeHa({ [annaToken]: { id: "ha-anna", name: "Anna" } }, { down: opts.down });
  const appOpts: AppOptions = { allowedIp: INGRESS, mcpEnabled: true, appUrl: APP };
  if (opts.oauth !== false) appOpts.oauth = { appUrl: APP, haUrl: HA, verifier: createHaTokenVerifier({ createSocket: ha.createSocket }) };
  const app = createApp(db, appOpts);
  const rpc = async (token: string | null, method: string, params: unknown = {}, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await app.request("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }, outsider);
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
  };
  return { db, app, rpc };
}

test("oauth: the protected-resource metadata names Home Assistant and is reachable past the ingress guard", async () => {
  const { app } = setup();
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const res = await app.request(path, {}, outsider);
    assert.equal(res.status, 200, path);
    assert.deepEqual(await res.json(), {
      resource: `${APP}/mcp`,
      authorization_servers: [HA],
      bearer_methods_supported: ["header"],
      resource_name: "Sweatbook",
    });
  }
  // The exception is exactly these paths: everything else stays behind the guard.
  assert.equal((await app.request("/.well-known/other", {}, outsider)).status, 403);
  assert.equal((await app.request("/api/me", { headers: { "X-Remote-User-Id": "ha-anna" } }, outsider)).status, 403);
});

test("oauth: without a token /mcp answers 401 with a challenge that points to the metadata", async () => {
  const { rpc } = setup();
  const res = await rpc(null, "tools/list");
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("www-authenticate"), `Bearer resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp"`);
});

test("oauth: a Home Assistant token acts as its user, creates the app user on first use and may write", async () => {
  const { db, rpc } = setup();
  const res = await rpc(annaToken, "tools/call", { name: "create_exercise", arguments: { name: "Kniebeuge", fields: ["weight", "reps"] } });
  assert.equal(res.status, 200);
  assert.equal(res.json.result.isError, undefined);
  const anna = db.prepare("SELECT id, display_name FROM app_user WHERE ha_user_id = ?").get("ha-anna") as { id: string; display_name: string };
  assert.equal(anna.display_name, "Anna");
  // Same user as on ingress: what the token created belongs to the ingress identity of that HA user.
  assert.equal(resolveUser(db, "ha-anna", null).id, anna.id);
  const created = db.prepare("SELECT user_id FROM exercise WHERE name = ?").get("Kniebeuge") as { user_id: string };
  assert.equal(created.user_id, anna.id);
});

test("oauth: unknown tokens are 401, forged ingress headers do not help", async () => {
  const { rpc } = setup();
  assert.equal((await rpc(jwt(), "tools/list")).status, 401);
  assert.equal((await rpc(null, "tools/list", {}, { "X-Remote-User-Id": "ha-anna" })).status, 401);
});

test("oauth: the app's own tokens keep working with their scope", async () => {
  const { db, rpc } = setup();
  const { token } = createToken(db, resolveUser(db, "ha-ben", null).id, { name: "script", scope: "read" });
  const res = await rpc(token, "tools/list");
  assert.equal(res.status, 200);
  const names = res.json.result.tools.map((t: { name: string }) => t.name);
  assert.ok(names.includes("get_today"));
  assert.ok(!names.includes("log_sets"));
});

test("oauth: Home Assistant unreachable fails closed with 503", async () => {
  const { rpc } = setup({ down: true });
  assert.equal((await rpc(jwt(), "tools/list")).status, 503);
});

test("oauth off: no metadata, plain challenge, Home Assistant tokens are not accepted", async () => {
  const { app, rpc } = setup({ oauth: false });
  assert.equal((await app.request("/.well-known/oauth-protected-resource/mcp", {}, outsider)).status, 403);
  const res = await rpc(annaToken, "tools/list");
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("www-authenticate"), "Bearer");
});

test("mcp info: the profile learns whether /mcp and OAuth are on and the public address", async () => {
  const ingress = { headers: { "X-Remote-User-Id": "ha-anna" } };
  const on = setup();
  assert.deepEqual(await (await on.app.request("/api/mcp", ingress, { incoming: { socket: { remoteAddress: INGRESS } } })).json(), {
    enabled: true,
    url: `${APP}/mcp`,
    oauth: true,
  });
  const plain = createApp(openDb(":memory:"));
  assert.deepEqual(await (await plain.request("/api/mcp", ingress)).json(), { enabled: false, url: null, oauth: false });
});
