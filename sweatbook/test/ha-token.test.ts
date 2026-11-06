import { test } from "node:test";
import assert from "node:assert/strict";
import { createHaTokenVerifier, HaUnavailableError, jwtExpiry } from "../src/auth/ha-token.ts";
import { fakeHa, jwt } from "./ha-auth-helpers.ts";

test("ha token: a valid token resolves to its Home Assistant user", async () => {
  const token = jwt();
  const ha = fakeHa({ [token]: { id: "ha-anna", name: "Anna" } });
  const verify = createHaTokenVerifier({ createSocket: ha.createSocket });
  const verified = await verify(token);
  assert.equal(verified?.haUserId, "ha-anna");
  assert.equal(verified?.name, "Anna");
  assert.equal(verified?.expiresAt, jwtExpiry(token));
});

test("ha token: unknown, malformed and expired tokens are null; expired ones without asking HA", async () => {
  const expired = jwt(-10);
  const ha = fakeHa({ [expired]: { id: "ha-anna", name: "Anna" } });
  const verify = createHaTokenVerifier({ createSocket: ha.createSocket });
  assert.equal(await verify(jwt()), null);
  assert.equal(await verify("garbage"), null);
  const before = ha.stats.connections;
  assert.equal(await verify(expired), null);
  assert.equal(ha.stats.connections, before);
});

test("ha token: system users (no credentials) are refused", async () => {
  const token = jwt();
  const ha = fakeHa({ [token]: { id: "supervisor", name: "Supervisor", credentials: [] } });
  assert.equal(await createHaTokenVerifier({ createSocket: ha.createSocket })(token), null);
});

test("ha token: answers are cached, so a busy client does not open a socket per request", async () => {
  const token = jwt();
  const ha = fakeHa({ [token]: { id: "ha-anna", name: "Anna" } });
  const verify = createHaTokenVerifier({ createSocket: ha.createSocket });
  await Promise.all([verify(token), verify(token)]);
  await verify(token);
  assert.equal(ha.stats.connections, 1);
});

test("ha token: Home Assistant unreachable is an error, not an invalid token", async () => {
  const verify = createHaTokenVerifier({ createSocket: fakeHa({}, { down: true }).createSocket });
  await assert.rejects(verify(jwt()), HaUnavailableError);
});
