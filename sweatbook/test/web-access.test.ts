import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpCommand, MCP_URL_PLACEHOLDER, scopeLabel } from "../web/src/logic/access.ts";

test("access: the connect command carries the token and the address", () => {
  assert.equal(
    mcpCommand("sb_abc", "https://example.org/mcp"),
    'claude mcp add --transport http sweatbook https://example.org/mcp --header "Authorization: Bearer sb_abc"',
  );
  assert.ok(mcpCommand("sb_abc").includes(MCP_URL_PLACEHOLDER));
});

test("access: scope labels", () => {
  assert.equal(scopeLabel("read"), "Nur lesen");
  assert.equal(scopeLabel("write"), "Lesen und Schreiben");
});
