import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";

const INGRESS = "172.30.32.2";
const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
const guarded = () => createApp(openDb(":memory:"), { allowedIp: INGRESS });
const user = { headers: { "X-Remote-User-Id": "ha-user-1" } };

test("guard: ingress address is served (also as IPv4-mapped IPv6)", async () => {
  const app = guarded();
  assert.equal((await app.request("/api/me", user, from(INGRESS))).status, 200);
  assert.equal((await app.request("/api/me", user, from("::ffff:" + INGRESS))).status, 200);
});

test("guard: other addresses are refused, forged user headers do not help", async () => {
  const app = guarded();
  for (const ip of ["172.30.32.3", "192.168.1.10", "127.0.0.1", "::1"]) {
    assert.equal((await app.request("/api/me", user, from(ip))).status, 403, ip);
  }
});

test("guard: without connection info it fails closed", async () => {
  assert.equal((await guarded().request("/api/me", user)).status, 403);
});

test("identity: no user header means no data", async () => {
  const app = createApp(openDb(":memory:"));
  assert.equal((await app.request("/api/sessions")).status, 401);
  assert.equal((await app.request("/api/me", user)).status, 200);
});
