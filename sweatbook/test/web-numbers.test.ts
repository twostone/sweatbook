import assert from "node:assert/strict";
import { test } from "node:test";
import { durationInput, formatDuration, parseDuration, parseKg, parseReps } from "../web/src/logic/numbers.ts";

test("time is typed as digits: the last two are seconds", () => {
  assert.equal(parseDuration("112"), 72);
  assert.equal(parseDuration("45"), 45);
  assert.equal(parseDuration("5"), 5);
  assert.equal(parseDuration("1000"), 600);
  assert.equal(parseDuration("1:12"), 72, "a colon (desktop, paste) is just ignored");
});

test("time: empty is null, more than 59 seconds or no digits is invalid", () => {
  assert.equal(parseDuration(""), null);
  assert.equal(parseDuration("  "), null);
  assert.equal(parseDuration("190"), undefined);
  assert.equal(parseDuration("abc"), undefined);
});

test("time shows as m:ss", () => {
  assert.equal(formatDuration(72), "1:12");
  assert.equal(formatDuration(45), "0:45");
  assert.equal(formatDuration(600), "10:00");
  assert.equal(formatDuration(0), "0:00");
});

test("time field reformats while typing", () => {
  assert.equal(durationInput("1"), "1");
  assert.equal(durationInput("11"), "11");
  assert.equal(durationInput("112"), "1:12");
  assert.equal(durationInput("1:120"), "11:20");
  assert.equal(durationInput("0:45"), "45", "leading zeros go, so deleting from a shown value works");
  assert.equal(durationInput(""), "");
});

test("kg: comma or point, empty is bodyweight, negative or text is invalid", () => {
  assert.equal(parseKg("102,5"), 102.5);
  assert.equal(parseKg("80.25"), 80.25);
  assert.equal(parseKg(" 100 "), 100);
  assert.equal(parseKg("0"), 0);
  assert.equal(parseKg(""), null);
  assert.equal(parseKg("-5"), undefined);
  assert.equal(parseKg("abc"), undefined);
  assert.equal(parseKg("1001"), undefined, "above the API's limit");
});

test("reps: whole numbers only", () => {
  assert.equal(parseReps("8"), 8);
  assert.equal(parseReps(""), null);
  assert.equal(parseReps("7,5"), undefined);
  assert.equal(parseReps("-1"), undefined);
});
