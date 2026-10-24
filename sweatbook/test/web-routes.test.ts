import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRoute, paths } from "../web/src/logic/routes.ts";

test("every path parses back to its route", () => {
  assert.deepEqual(parseRoute(paths.start()), { name: "start" });
  assert.deepEqual(parseRoute(paths.session("s1")), { name: "session", sessionId: "s1" });
  assert.deepEqual(parseRoute(paths.block("s1", "b1")), { name: "block", sessionId: "s1", blockId: "b1" });
  assert.deepEqual(parseRoute(paths.history()), { name: "history" });
  assert.deepEqual(parseRoute(paths.catalog()), { name: "catalog" });
  assert.deepEqual(parseRoute(paths.exercise("e1")), { name: "exercise", exerciseId: "e1" });
  assert.deepEqual(parseRoute(paths.newExercise("Rudern Kabel")), { name: "new-exercise", prefill: "Rudern Kabel", fromSheet: false });
  assert.deepEqual(parseRoute(paths.newExercise("Rudern & Kabel", true)), { name: "new-exercise", prefill: "Rudern & Kabel", fromSheet: true });
});

test("no hash or an unknown one is the start", () => {
  assert.deepEqual(parseRoute(""), { name: "start" });
  assert.deepEqual(parseRoute("#/irgendwas"), { name: "start" });
});
