import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRange, rangeInput } from "../web/src/logic/range.ts";

test("parseRange reads a number, a range and an empty field", () => {
  assert.deepEqual(parseRange("5"), [5, 5]);
  assert.deepEqual(parseRange("5-8"), [5, 8]);
  assert.deepEqual(parseRange(" 5 – 8 "), [5, 8]);
  assert.equal(parseRange(""), null);
  assert.equal(parseRange("  "), null);
});

test("parseRange rejects what the API would reject", () => {
  assert.equal(parseRange("8-5"), undefined);
  assert.equal(parseRange("a"), undefined);
  assert.equal(parseRange("5-"), undefined);
  assert.equal(parseRange("-5"), undefined);
  assert.equal(parseRange("1,5"), undefined);
  assert.equal(parseRange("100001"), undefined);
});

test("rangeInput shows a fixed number once", () => {
  assert.equal(rangeInput([5, 5]), "5");
  assert.equal(rangeInput([5, 8]), "5–8");
  assert.equal(rangeInput(null), "");
});
