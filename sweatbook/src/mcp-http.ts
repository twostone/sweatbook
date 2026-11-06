import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Db } from "./db.ts";
import { resolveToken, TOKEN_PREFIX, type TokenOwner } from "./data/tokens.ts";
import { resolveUser } from "./data/users.ts";
import { HaUnavailableError, type HaTokenVerifier } from "./auth/ha-token.ts";
import { metadataUrl } from "./auth/resource-metadata.ts";
import { logger } from "./log.ts";
import { createMcpServer } from "./mcp.ts";

const log = logger("mcp");

// Wrong tokens per client address: after this many in a window the client has to wait. In memory, a restart resets it.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 60_000;

export function createFailureLimiter() {
  const failures = new Map<string, { count: number; resetAt: number }>();
  return {
    blocked(key: string, now: number): boolean {
      const entry = failures.get(key);
      return !!entry && entry.resetAt > now && entry.count >= MAX_FAILURES;
    },
    note(key: string, now: number): void {
      const entry = failures.get(key);
      if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
      else entry.count++;
    },
  };
}
export type FailureLimiter = ReturnType<typeof createFailureLimiter>;

function clientKey(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

// OAuth through Home Assistant: HA issues the tokens, this app checks them. Absent = only the app's own tokens.
export type McpOAuth = { verifier: HaTokenVerifier; appUrl: string };
export type McpOptions = { limiter: FailureLimiter; version?: string; oauth?: McpOAuth };

// Who a bearer token belongs to. The app's own tokens carry their prefix; anything else can only be a Home Assistant
// token, which may do what its user may do in the UI (HA has no scopes). The HA user gets an app_user like on ingress.
// Throws HaUnavailableError when Home Assistant cannot be asked.
async function tokenOwner(db: Db, token: string, oauth: McpOAuth | undefined): Promise<TokenOwner | null> {
  if (token.startsWith(TOKEN_PREFIX)) return resolveToken(db, token);
  if (!oauth) return null;
  const verified = await oauth.verifier(token);
  if (!verified) return null;
  return { user_id: resolveUser(db, verified.haUserId, verified.name).id, scope: "write" };
}

// POST /mcp: Streamable HTTP, stateless (a server and transport per request). The only way in is a bearer token (the
// app's own or, with OAuth, one from Home Assistant); X-Remote-User-* headers are ignored here, because this route is
// reachable without the ingress guard.
export async function handleMcp(c: Context, db: Db, opts: McpOptions): Promise<Response> {
  const key = clientKey(c);
  const now = Date.now();
  if (opts.limiter.blocked(key, now)) return c.json({ error: "too many attempts" }, 429);

  const match = /^Bearer (\S+)$/.exec(c.req.header("Authorization") ?? "");
  let owner: TokenOwner | null = null;
  if (match) {
    try {
      owner = await tokenOwner(db, match[1]!, opts.oauth);
    } catch (err) {
      // Fail closed, but do not count it as a wrong token: the client is not at fault.
      if (err instanceof HaUnavailableError) return c.json({ error: "authorization server unavailable" }, 503);
      throw err;
    }
  }
  if (!owner) {
    opts.limiter.note(key, now);
    // With OAuth the challenge points MCP clients to the metadata, from where they find Home Assistant (RFC 9728).
    const challenge = opts.oauth ? `Bearer resource_metadata="${metadataUrl(opts.oauth.appUrl)}"` : "Bearer";
    return c.json({ error: "invalid token" }, 401, { "WWW-Authenticate": challenge });
  }

  const server = createMcpServer(db, { userId: owner.user_id, scope: owner.scope }, opts.version);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } catch (err) {
    log.error("request_failed", { err, stack: err instanceof Error ? err.stack : undefined });
    return c.json({ error: "internal error" }, 500);
  }
}
