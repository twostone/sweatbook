import assert from "node:assert/strict";
import { test } from "node:test";
import * as server from "../src/data/muscles.ts";
import { BACK, FRONT, smoothPath } from "../web/src/logic/muscle-map.ts";
import { barParts, cycleRole, formatWeightedSets, HEAT_LEVELS, heatLevel, MUSCLES, PRIMARY_WEIGHT, roleOf, SECONDARY_WEIGHT, sessionMuscles } from "../web/src/logic/muscles.ts";
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

test("heatLevel: 0 untrained, top step for the most trained, at least 1 for anything trained", () => {
  assert.equal(heatLevel(0, 8), 0);
  assert.equal(heatLevel(8, 8), HEAT_LEVELS);
  assert.equal(heatLevel(0.5, 8), 1);
  assert.equal(heatLevel(4, 8), 2);
  assert.equal(heatLevel(4.5, 8), 3);
  assert.equal(heatLevel(3, 0), 0);
  let last = 0;
  for (let sets = 0; sets <= 8; sets += 0.5) {
    const level = heatLevel(sets, 8);
    assert.ok(level >= last, `monotonic at ${sets}`);
    last = level;
  }
});

test("barParts: primary full and secondary half add up to the weighted sets", () => {
  const parts = barParts({ muscle: "chest", sets: 3.5, primary_sets: 3, secondary_sets: 1 }, 7);
  assert.equal(parts.primary, 3 / 7);
  assert.equal(parts.secondary, 0.5 / 7);
  assert.equal(parts.primary + parts.secondary, 3.5 / 7);
  assert.deepEqual(barParts({ muscle: "triceps", sets: 2, primary_sets: 0, secondary_sets: 4 }, 4), { primary: 0, secondary: 0.5 });
});

test("body map: every muscle group has a shape in the front or back view", () => {
  const drawn = new Set([...Object.keys(FRONT.muscles), ...Object.keys(BACK.muscles)]);
  assert.deepEqual(MUSCLES.filter((m) => !drawn.has(m)), []);
  assert.deepEqual([...drawn].filter((m) => !(MUSCLES as string[]).includes(m)), []);
});

test("smoothPath: closed curve through every corner", () => {
  const d = smoothPath([[0, 0], [10, 0], [10, 10]]);
  assert.match(d, /^M0,0C/);
  assert.match(d, /Z$/);
  assert.equal(d.match(/C/g)?.length, 3);
  for (const corner of ["10,0", "10,10", "0,0Z"]) assert.ok(d.includes(` ${corner}`), corner);
});
