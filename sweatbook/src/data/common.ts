import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";

// 404: the thing does not exist, or belongs to another user (never tell the two apart).
export class NotFoundError extends Error {}
// 403: the user may see the thing but not do this to it (only the owner of a shared program deletes or renames it).
export class ForbiddenError extends Error {}
// 409: the request is valid but clashes with what is stored (a taken name, an archived exercise, …).
export class ConflictError extends Error {
  constructor(
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}
// 400 for rules zod cannot see because they depend on stored data (which set fields an exercise takes, …).
export class InvalidError extends Error {}

export const newId = (): string => randomUUID();

// How names and aliases are compared: spaces collapsed, case ignored. In JS, because SQLite's lower() only knows ASCII
// ("Übung" and "übung" would differ there); the unique indexes on lower() are only a backstop.
export const tidy = (text: string): string => text.trim().replace(/\s+/g, " ");
export const nameKey = (text: string): string => tidy(text).toLocaleLowerCase("de");

// Next free position in an ordered list (blocks of a session, exercises of a block, sets of an exercise, plan lines).
export function nextPosition(db: Db, table: "block" | "block_exercise" | "set_log" | "planned_session" | "planned_item", parentColumn: string, parentId: string): number {
  const row = db.prepare(`SELECT MAX(position) AS p FROM ${table} WHERE ${parentColumn} = ?`).get(parentId) as { p: number | null };
  return (row.p ?? -1) + 1;
}

export const toBool = (value: unknown): boolean => value === 1;
