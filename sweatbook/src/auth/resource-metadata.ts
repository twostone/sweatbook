import { Hono } from "hono";
import { cors } from "hono/cors";

// RFC 9728 protected-resource metadata: this app is the resource server, Home Assistant the authorization server.
// MCP clients (connectors with client-id metadata documents, Claude Code via loopback) find HA from here and get their
// tokens from HA directly. Public by design, hence the open CORS.
export const RESOURCE_METADATA_PATHS = ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"];

export function resourceMetadata(appUrl: string, haUrl: string) {
  const document = {
    resource: `${appUrl}/mcp`,
    authorization_servers: [haUrl],
    bearer_methods_supported: ["header"],
    resource_name: "Sweatbook",
  };
  const app = new Hono();
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));
  // Both forms: path-aware (RFC 9728 for the /mcp resource) and the plain one that some clients probe first.
  for (const path of RESOURCE_METADATA_PATHS) app.get(path, (c) => c.json(document));
  return app;
}

/** URL advertised in the WWW-Authenticate challenge. */
export const metadataUrl = (appUrl: string) => `${appUrl}${RESOURCE_METADATA_PATHS[1]}`;
