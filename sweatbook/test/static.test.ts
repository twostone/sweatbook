import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { serveFrontend } from "../src/static.ts";

function frontend() {
  const root = mkdtempSync(join(tmpdir(), "sweatbook-static-"));
  mkdirSync(join(root, "_app", "immutable", "entry"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<!doctype html>");
  writeFileSync(join(root, "_app", "version.json"), "{}");
  writeFileSync(join(root, "_app", "immutable", "entry", "start.abc123.js"), "");
  return new Hono().use("/*", serveFrontend(root));
}

test("static: index.html and version.json are revalidated, so an update never leaves old file names behind", async () => {
  const app = frontend();
  for (const path of ["/", "/index.html", "/_app/version.json"]) {
    const res = await app.request(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get("Cache-Control"), "no-cache", path);
  }
});

test("static: hashed files are cached for good", async () => {
  const res = await frontend().request("/_app/immutable/entry/start.abc123.js");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
});

test("static: a missing file gets no cache header", async () => {
  const res = await frontend().request("/_app/immutable/entry/start.old.js");
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("Cache-Control"), null);
});
