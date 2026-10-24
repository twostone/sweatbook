import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";

export type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>;

// A fresh in-memory app; `as` returns a caller for one Home Assistant user (X-Remote-User-Id).
export function setup() {
  const db = openDb(":memory:");
  const app = createApp(db);
  const as =
    (haUserId: string | null): Call =>
    async (method, path, body) => {
      const headers: Record<string, string> = haUserId ? { "X-Remote-User-Id": haUserId } : {};
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    };
  return { db, app, as, call: as("ha-user-1") };
}

export const squat = { name: "Kniebeuge", metrics: "weight_reps" };
export const pullup = { name: "Klimmzüge", metrics: "weight_reps" };
export const deadhang = { name: "Deadhang", metrics: "duration" };

// A session with one block per exercise; returns the session tree.
export async function sessionWith(call: Call, exerciseIds: string[], startedAt = "2026-10-24T11:00:00Z") {
  let tree = (await call("POST", "/api/sessions", { started_at: startedAt })).json;
  for (const exerciseId of exerciseIds) tree = (await call("POST", `/api/sessions/${tree.id}/blocks`, { exercise_id: exerciseId })).json;
  return tree;
}
