import assert from "node:assert/strict";
import { test } from "node:test";
import { addAlias, matches, similarExercises } from "../web/src/logic/catalog.ts";
import type { Exercise } from "../web/src/types.ts";

const ex = (id: string, name: string, aliases: string[] = [], archived = false): Exercise => ({
  id,
  name,
  fields: ["weight", "reps"],
  note: null,
  archived,
  aliases,
  last_used_at: null,
});

test("search matches name or alias anywhere, ignoring case and umlaut case", () => {
  const bench = ex("1", "Bankdrücken", ["Bench Press"]);
  assert.ok(matches(bench, "drück"));
  assert.ok(matches(bench, "DRÜCK"));
  assert.ok(matches(bench, "bench"));
  assert.ok(matches(bench, "  "), "an empty search matches all");
  assert.ok(!matches(bench, "kniebeuge"));
});

test("similar exercises share a word of the new name, the exercise itself is left out", () => {
  const catalog = [ex("1", "Rudern vorgebeugt"), ex("2", "Rudern einarmig (KH)"), ex("3", "Kniebeuge"), ex("4", "Bankziehen", ["Bench Row"])];
  assert.deepEqual(
    similarExercises(catalog, "Rudern Kabel sitzend").map((e) => e.id),
    ["1", "2"],
  );
  assert.deepEqual(similarExercises(catalog, "row").map((e) => e.id), ["4"], "short names still find what the search finds");
  assert.deepEqual(similarExercises(catalog, "KH Bankdrücken").map((e) => e.id), [], "words under four letters alone are too unspecific");
  assert.deepEqual(similarExercises(catalog, "Bench Rows").map((e) => e.id), ["4"], "aliases count");
  assert.deepEqual(similarExercises(catalog, "Rudern vorgebeugt", "1").map((e) => e.id), ["2"]);
  assert.deepEqual(similarExercises(catalog, "").map((e) => e.id), []);
});

test("an alias is added tidied, once, and never as the name itself", () => {
  assert.deepEqual(addAlias(["Bench Press"], "  Flat   Bench ", "Bankdrücken"), ["Bench Press", "Flat Bench"]);
  assert.deepEqual(addAlias(["Bench Press"], "bench press", "Bankdrücken"), ["Bench Press"]);
  assert.deepEqual(addAlias([], "BANKDRÜCKEN", "Bankdrücken"), []);
  assert.deepEqual(addAlias([], "   ", "Bankdrücken"), []);
});
