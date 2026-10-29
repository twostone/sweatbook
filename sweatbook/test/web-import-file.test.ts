import { test } from "node:test";
import assert from "node:assert/strict";
import { countImport, importErrorText, parseImportFile } from "../web/src/logic/import-file.ts";

test("countImport: weeks, sessions, lines and tests of the dry run", () => {
  const program = { weeks: [{ sessions: [{ items: [1, 2] }, { items: [3] }] }, { sessions: [{ items: [] }] }], tests: [1, 2, 3] };
  assert.deepEqual(countImport(program), { weeks: 2, sessions: 3, lines: 3, tests: 3 });
});

test("parseImportFile: JSON or null", () => {
  assert.deepEqual(parseImportFile('{"a":1}'), { a: 1 });
  assert.equal(parseImportFile("<html>"), null);
});

test("importErrorText: the server's sentence, else the first issue with its place, else a generic one", () => {
  assert.equal(importErrorText({ error: 'week 2 A, line 2: unknown exercise "x"' }), 'week 2 A, line 2: unknown exercise "x"');
  const issues = JSON.stringify([{ path: ["file", "weeks", 0, "number"], message: "Invalid input" }]);
  assert.equal(importErrorText({ success: false, error: { name: "ZodError", message: issues } }), "weeks › 0 › number: Invalid input");
  assert.equal(importErrorText({ error: { message: "kaputt" } }), "Die Datei passt nicht zum Format.");
  assert.equal(importErrorText({}), "Die Datei passt nicht zum Format.");
});
