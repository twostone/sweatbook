import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLine, parseLevel, resolveLogLevel } from "../src/log.ts";

test("log: one logfmt line, values with spaces quoted", () => {
  const line = formatLine("warn", "app", "request", { path: "/api/x", ms: 12, note: "a b", gone: undefined }, new Date(0));
  assert.match(line, /^\S+ WARN app request path=\/api\/x ms=12 note="a b"$/);
});

test("log: level from the app option, HA's 'warning' means warn", () => {
  assert.equal(parseLevel("warning"), "warn");
  assert.deepEqual(resolveLogLevel({ log_level: "debug" }, "error"), { level: "debug", invalid: null });
  assert.deepEqual(resolveLogLevel({}, undefined), { level: "info", invalid: null });
  assert.deepEqual(resolveLogLevel({ log_level: "loud" }), { level: "info", invalid: "loud" });
});
