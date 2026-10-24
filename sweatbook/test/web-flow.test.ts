import assert from "node:assert/strict";
import { test } from "node:test";
import { blockStatus, doneCount, nextBlock, nextInRound, overviewTarget } from "../web/src/logic/flow.ts";
import type { SessionBlock, SetLog } from "../web/src/types.ts";

const aSet = { id: "x" } as SetLog;
// One block per entry: true = it has sets.
const blocks = (...withSets: boolean[]): SessionBlock[] =>
  withSets.map((has, i) => ({
    id: `b${i}`,
    position: i + 1,
    type: "straight",
    exercises: [
      { id: `be${i}`, position: 1, exercise: { id: `e${i}`, name: `Übung ${i}`, fields: ["weight", "reps"], archived: false }, note: null, sets: has ? [aSet] : [], last_time: null },
    ],
  }));

test("the last block with sets is current, earlier ones with sets are done, the rest open", () => {
  const b = blocks(true, false, true, false);
  assert.deepEqual(
    b.map((_, i) => blockStatus(b, i)),
    ["done", "open", "current", "open"],
  );
  assert.equal(doneCount(b), 1);
});

test("overview goes on with the current block, else the first one", () => {
  assert.equal(overviewTarget(blocks(true, true, false))?.id, "b1");
  assert.equal(overviewTarget(blocks(false, false))?.id, "b0");
  assert.equal(overviewTarget([]), null);
});

test("the exercise page goes to the next block in order, none after the last", () => {
  const b = blocks(true, false, false);
  assert.equal(nextBlock(b, "b0")?.id, "b1");
  assert.equal(nextBlock(b, "b2"), null);
  assert.equal(nextBlock(b, "unknown"), null);
});

test("in a superset the next set is due where the fewest sets are", () => {
  const ex = (n: number) => ({ sets: Array.from({ length: n }, () => aSet) });
  assert.equal(nextInRound([ex(2), ex(1)]), 1);
  assert.equal(nextInRound([ex(1), ex(1)]), 0);
  assert.equal(nextInRound([ex(0), ex(0), ex(0)]), 0);
});
