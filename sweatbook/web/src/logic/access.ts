// Access tokens for the MCP endpoint (Claude and other agents): the command that connects Claude Code to the server.
// The address is not known to the app (it is reached from outside, not through ingress), so the user fills it in.
export const MCP_URL_PLACEHOLDER = "https://<adresse-der-app>/mcp";

export function mcpCommand(token: string, url = MCP_URL_PLACEHOLDER): string {
  return `claude mcp add --transport http sweatbook ${url} --header "Authorization: Bearer ${token}"`;
}

export const scopeLabel = (scope: "read" | "write"): string => (scope === "write" ? "Lesen und Schreiben" : "Nur lesen");
