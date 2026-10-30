import { createHash, randomBytes } from "node:crypto";
import { isoNow, type Db } from "../db.ts";
import { newId, NotFoundError, tidy } from "./common.ts";

// API tokens for the MCP endpoint. A token acts as the user who created it; `read` may only look, `write` may change.
export type TokenScope = "read" | "write";
export type ApiToken = { id: string; name: string; scope: TokenScope; created_at: string; last_used_at: string | null };
export type TokenOwner = { user_id: string; scope: TokenScope };

export const TOKEN_PREFIX = "sb_";
const TOKEN_BYTES = 32;
// last_used_at is only rewritten when it is older than this, so a busy client does not write on every call.
const LAST_USED_GRANULARITY_MS = 60_000;

// SHA-256 is enough because the token itself is random with 256 bits; a slow hash would only cost time on every request.
const hashToken = (plain: string): string => createHash("sha256").update(plain).digest("hex");

export function createToken(db: Db, userId: string, input: { name: string; scope: TokenScope }): { token: string; info: ApiToken } {
  const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  const id = newId();
  db.prepare("INSERT INTO api_token (id, user_id, name, token_hash, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    userId,
    tidy(input.name),
    hashToken(token),
    input.scope,
    isoNow(),
  );
  return { token, info: db.prepare(`SELECT ${COLUMNS} FROM api_token WHERE id = ?`).get(id) as ApiToken };
}

const COLUMNS = "id, name, scope, created_at, last_used_at";

export function listTokens(db: Db, userId: string): ApiToken[] {
  return db.prepare(`SELECT ${COLUMNS} FROM api_token WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`).all(userId) as ApiToken[];
}

export function revokeToken(db: Db, userId: string, id: string): void {
  if (db.prepare("DELETE FROM api_token WHERE id = ? AND user_id = ?").run(id, userId).changes === 0) throw new NotFoundError("token");
}

// Who a presented token belongs to, or null. Hashes are compared by the index lookup, never the token itself.
export function resolveToken(db: Db, plain: string, now: Date = new Date()): TokenOwner | null {
  if (!plain.startsWith(TOKEN_PREFIX)) return null;
  const row = db.prepare("SELECT id, user_id, scope, last_used_at FROM api_token WHERE token_hash = ?").get(hashToken(plain)) as
    | { id: string; user_id: string; scope: TokenScope; last_used_at: string | null }
    | undefined;
  if (!row) return null;
  if (!row.last_used_at || now.getTime() - Date.parse(row.last_used_at) >= LAST_USED_GRANULARITY_MS) {
    db.prepare("UPDATE api_token SET last_used_at = ? WHERE id = ?").run(now.toISOString(), row.id);
  }
  return { user_id: row.user_id, scope: row.scope };
}
