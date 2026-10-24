import assert from "node:assert/strict";
import { test } from "node:test";
import { fromLocalInput, toLocalInput } from "../web/src/logic/dates.ts";

test("datetime-local round trip keeps the minute", () => {
  const iso = "2026-10-24T11:40:00.000Z";
  assert.equal(fromLocalInput(toLocalInput(iso)), iso);
  assert.match(toLocalInput(iso), /^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
});

test("empty or broken input gives null", () => {
  assert.equal(fromLocalInput(""), null);
  assert.equal(fromLocalInput("kaputt"), null);
});
