import type {
  Exercise,
  ExerciseInput,
  Me,
  SessionPatch,
  SessionSummary,
  SessionTree,
  SetInput,
  SetLog,
} from "./types";

// All URLs are relative to the document (never "/api/..."): the app runs under a changing HA ingress prefix.

// Server error codes (src/app.ts, src/data/*) in the words the user sees.
const MESSAGES: Record<string, string> = {
  "name taken": "Den Namen gibt es schon im Katalog.",
  "exercise archived": "Die Übung ist archiviert.",
  "exercise in use": "Die Übung wird schon benutzt und lässt sich nur archivieren.",
  "exercise has sets": "Die Satzfelder lassen sich nicht mehr ändern, die Übung hat schon Sätze.",
  "ended_at before started_at": "Das Ende liegt vor dem Start.",
};

const OFFLINE_MESSAGE = "Keine Verbindung. Die Eingaben bleiben auf dem Handy gespeichert.";
// A gateway answering for an unreachable app (HA ingress, the Vite proxy) counts as no connection, like a dead spot.
const GATEWAY_ERRORS = [502, 503, 504];

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number, // 0 = no answer (network)
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0 || GATEWAY_ERRORS.includes(this.status);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(new URL(path, document.baseURI), {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, 0);
  }
  if (!res.ok) {
    const data = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const code = typeof data.error === "string" ? data.error : "";
    const message =
      MESSAGES[code] ??
      (GATEWAY_ERRORS.includes(res.status) ? OFFLINE_MESSAGE : null) ??
      (res.status === 400
        ? "Eingabe ungültig."
        : res.status === 401
          ? "Kein Nutzer: Die App läuft nur über Home Assistant."
          : res.status === 404
            ? "Nicht gefunden. Bitte neu laden."
            : "Unerwarteter Fehler.");
    throw new ApiError(message, res.status, data);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const enc = encodeURIComponent;

export const getMe = () => request<Me>("GET", "api/me");

// Catalog incl. archived ones, searched over names and aliases, recently used first.
export const listExercises = (q = "") => request<Exercise[]>("GET", q ? `api/exercises?q=${enc(q)}` : "api/exercises");
export const createExercise = (e: ExerciseInput) => request<Exercise>("POST", "api/exercises", e);

export const listSessions = (limit = 20) => request<SessionSummary[]>("GET", `api/sessions?limit=${limit}`);
export const createSession = (s: { title?: string | null; started_at?: string } = {}) =>
  request<SessionTree>("POST", "api/sessions", s);
export const getSession = (id: string) => request<SessionTree>("GET", `api/sessions/${enc(id)}`);
// ended_at null reopens; fields left out stay.
export const updateSession = (id: string, p: SessionPatch) => request<SessionTree>("PATCH", `api/sessions/${enc(id)}`, p);
export const deleteSession = (id: string) => request<void>("DELETE", `api/sessions/${enc(id)}`);

// Block changes answer with the whole session.
export const addBlock = (sessionId: string, exerciseId: string) =>
  request<SessionTree>("POST", `api/sessions/${enc(sessionId)}/blocks`, { exercise_id: exerciseId });
export const setBlockOrder = (sessionId: string, blockIds: string[]) =>
  request<SessionTree>("PUT", `api/sessions/${enc(sessionId)}/block-order`, { block_ids: blockIds });
export const addExerciseToBlock = (blockId: string, exerciseId: string) =>
  request<SessionTree>("POST", `api/blocks/${enc(blockId)}/exercises`, { exercise_id: exerciseId });
export const addRound = (blockId: string, sets: (SetInput & { block_exercise_id: string })[]) =>
  request<SessionTree>("POST", `api/blocks/${enc(blockId)}/rounds`, { sets });
export const deleteBlock = (blockId: string) => request<SessionTree>("DELETE", `api/blocks/${enc(blockId)}`);
export const removeBlockExercise = (blockExerciseId: string) =>
  request<SessionTree>("DELETE", `api/block-exercises/${enc(blockExerciseId)}`);

export const addSets = (blockExerciseId: string, sets: SetInput[]) =>
  request<SetLog[]>("POST", `api/block-exercises/${enc(blockExerciseId)}/sets`, { sets });
export const updateSet = (id: string, s: SetInput) => request<SetLog>("PATCH", `api/sets/${enc(id)}`, s);
export const deleteSet = (id: string) => request<void>("DELETE", `api/sets/${enc(id)}`);
