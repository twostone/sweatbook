import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizationHeader, mcpCommand, mcpJsonConfig, MCP_URL_PLACEHOLDER, scopeLabel, TOKEN_PLACEHOLDER } from "../web/src/logic/access.ts";

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

test("access: the JSON configuration is valid and carries token and address; without them it holds placeholders", () => {
  const config = JSON.parse(mcpJsonConfig("sb_abc", "https://example.org/mcp"));
  assert.deepEqual(config.mcpServers.sweatbook, { type: "http", url: "https://example.org/mcp", headers: { Authorization: "Bearer sb_abc" } });
  const bare = JSON.parse(mcpJsonConfig());
  assert.equal(bare.mcpServers.sweatbook.url, MCP_URL_PLACEHOLDER);
  assert.equal(bare.mcpServers.sweatbook.headers.Authorization, `Bearer ${TOKEN_PLACEHOLDER}`);
  assert.equal(authorizationHeader("sb_abc"), "Authorization: Bearer sb_abc");
});
