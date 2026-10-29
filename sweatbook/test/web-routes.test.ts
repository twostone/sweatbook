import assert from "node:assert/strict";
import { test } from "node:test";
import { hashQuery, paths } from "../web/src/logic/routes.ts";

test("paths are hash routes", () => {
  assert.equal(paths.start(), "#/");
  assert.equal(paths.session("s1"), "#/s/s1");
  assert.equal(paths.block("s1", "b1"), "#/s/s1/b/b1");
  assert.equal(paths.history(), "#/history");
  assert.equal(paths.catalog(), "#/exercises");
  assert.equal(paths.programs(), "#/programs");
  assert.equal(paths.programImport(), "#/programs/import");
  assert.equal(paths.program("p1"), "#/programs/p1");
  assert.equal(paths.plannedSession("p1", "x2"), "#/programs/p1/s/x2");
  assert.equal(paths.exercise("e1"), "#/exercises/e1");
});

test("the new-exercise path carries the name and the way back to the sheet in the query", () => {
  const query = hashQuery;
  assert.equal(paths.newExercise("Rudern Kabel").startsWith("#/exercises/new?"), true);
  assert.equal(query(paths.newExercise("Rudern & Kabel")).get("name"), "Rudern & Kabel");
  assert.equal(query(paths.newExercise("Rudern & Kabel")).get("from"), null);
  assert.equal(query(paths.newExercise("Rudern", true)).get("from"), "sheet");
});

test("a hash without a query has no parameters", () => {
  assert.equal(hashQuery("#/exercises/new").get("name"), null);
  assert.equal(hashQuery("").get("name"), null);
});
