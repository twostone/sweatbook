import assert from "node:assert/strict";
import { test } from "node:test";
import * as server from "../src/data/muscles.ts";
import { cycleRole, formatWeightedSets, MUSCLES, PRIMARY_WEIGHT, roleOf, SECONDARY_WEIGHT, sessionMuscles } from "../web/src/logic/muscles.ts";
import type { Muscles } from "../web/src/types.ts";

test("muscles: the client knows exactly the server's groups, in its order, with the same weights", () => {
  assert.deepEqual(MUSCLES, [...server.MUSCLES]);
  assert.equal(PRIMARY_WEIGHT, server.PRIMARY_WEIGHT);
  assert.equal(SECONDARY_WEIGHT, server.SECONDARY_WEIGHT);
});

test("cycleRole: off -> primary -> secondary -> off, lists in list order", () => {
  let m: Muscles = { primary: ["quads"], secondary: [] };
  m = cycleRole(m, "chest");
  assert.deepEqual(m, { primary: ["chest", "quads"], secondary: [] });
  m = cycleRole(m, "chest");
  assert.deepEqual(m, { primary: ["quads"], secondary: ["chest"] });
  assert.equal(roleOf(m, "chest"), "secondary");
  m = cycleRole(m, "chest");
  assert.deepEqual(m, { primary: ["quads"], secondary: [] });
  assert.equal(roleOf(m, "chest"), null);
});

test("sessionMuscles: same result as the server for the same session", () => {
  const set = {};
  const blocks = [
    { exercises: [{ exercise: { id: "bench", muscles: { primary: ["chest"], secondary: ["front_delts", "triceps"] } as Muscles }, sets: [set, set, set] }] },
    {
      exercises: [
        { exercise: { id: "dips", muscles: { primary: ["triceps"], secondary: ["chest"] } as Muscles }, sets: [set] },
        { exercise: { id: "plank", muscles: { primary: [], secondary: [] } as Muscles }, sets: [set, set] },
        { exercise: { id: "row", muscles: { primary: ["upper_back"], secondary: [] } as Muscles }, sets: [] },
      ],
    },
  ];
  const client = sessionMuscles(blocks);
  assert.deepEqual(client, server.sessionMuscles(blocks));
  assert.deepEqual(client.muscles.map((c) => [c.muscle, c.sets]), [["chest", 3.5], ["triceps", 2.5], ["front_delts", 1.5]]);
  assert.equal(client.untagged_sets, 2);
});

test("formatWeightedSets: German decimals, singular for one", () => {
  assert.equal(formatWeightedSets(4.5), "4,5 Sätze");
  assert.equal(formatWeightedSets(1), "1 Satz");
  assert.equal(formatWeightedSets(0.5), "0,5 Sätze");
});

test("sessionMuscles: a session cached before muscle groups existed counts as untagged", () => {
  assert.deepEqual(sessionMuscles([{ exercises: [{ exercise: {}, sets: [{}, {}] }] }]), { muscles: [], untagged_sets: 2 });
});
