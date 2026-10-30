import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Db } from "./db.ts";
import { resolveToken } from "./data/tokens.ts";
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

// POST /mcp: Streamable HTTP, stateless (a server and transport per request). The only way in is a token of the app;
// X-Remote-User-* headers are ignored here, because this route is reachable without the ingress guard.
export async function handleMcp(c: Context, db: Db, limiter: FailureLimiter, version?: string): Promise<Response> {
  const key = clientKey(c);
  const now = Date.now();
  if (limiter.blocked(key, now)) return c.json({ error: "too many attempts" }, 429);

  const match = /^Bearer (\S+)$/.exec(c.req.header("Authorization") ?? "");
  const owner = match ? resolveToken(db, match[1]!) : null;
  if (!owner) {
    limiter.note(key, now);
    return c.json({ error: "invalid token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const server = createMcpServer(db, { userId: owner.user_id, scope: owner.scope }, version);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } catch (err) {
    log.error("request_failed", { err, stack: err instanceof Error ? err.stack : undefined });
    return c.json({ error: "internal error" }, 500);
  }
}
