// Access tokens for the MCP endpoint: what a person needs to connect any MCP-capable agent to the server.
// The address is only known when the option app_external_url is set; otherwise the user fills it in.
export const MCP_URL_PLACEHOLDER = "https://<adresse-der-app>/mcp";
export const TOKEN_PLACEHOLDER = "<access-token>";

export const authorizationHeader = (token = TOKEN_PLACEHOLDER): string => `Authorization: Bearer ${token}`;

// The configuration most MCP clients (Cursor, VS Code, Claude Desktop via a remote bridge, ...) read.
export function mcpJsonConfig(token = TOKEN_PLACEHOLDER, url = MCP_URL_PLACEHOLDER): string {
  return JSON.stringify({ mcpServers: { sweatbook: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

// One example among several: Claude Code.
export function mcpCommand(token = TOKEN_PLACEHOLDER, url = MCP_URL_PLACEHOLDER): string {
  return `claude mcp add --transport http sweatbook ${url} --header "Authorization: Bearer ${token}"`;
}

export const scopeLabel = (scope: "read" | "write"): string => (scope === "write" ? "Lesen und Schreiben" : "Nur lesen");

// With OAuth through Home Assistant the client needs only the address; it finds HA and signs in by itself.
export function mcpOAuthCommand(url = MCP_URL_PLACEHOLDER): string {
  return `claude mcp add --transport http sweatbook ${url}`;
}
