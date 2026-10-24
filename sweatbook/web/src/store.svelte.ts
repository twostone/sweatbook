import * as api from "./api";
import { ApiError } from "./api";
import { goUp, navigate, paths } from "./router.svelte";
import { load, save } from "./storage";
import type { Me, SessionSummary, SessionTree, SetInput, SetLog } from "./types";

// Where the "add exercise" sheet puts the exercise it is given.
export type AddTarget = { sessionId: string; blockId: string | null; openAfter: boolean }; // blockId null = new block

export type SheetState =
  | { kind: "none" }
  | { kind: "add-exercise"; target: AddTarget; query: string }
  | { kind: "session"; sessionId: string }
  | { kind: "block-menu"; sessionId: string; blockId: string }
  | { kind: "log-session" };

export const app = $state({
  ready: false,
  me: null as Me | null,
  session: null as SessionTree | null,
  sessions: [] as SessionSummary[],
  // The session on screen is the stored copy, the server could not be reached.
  stale: false,
  error: "",
  sheet: { kind: "none" } as SheetState,
  // Set by "Übung anlegen" before it returns to the sheet, which then searches for it and marks it.
  created: null as { id: string; name: string } | null,
});

const SESSION_CACHE = "session";

function setSession(tree: SessionTree) {
  app.session = tree;
  app.stale = false;
  save(SESSION_CACHE, tree);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const cacheSession = () => app.session && save(SESSION_CACHE, $state.snapshot(app.session));

// Runs an action and shows its error instead of throwing. Returns success.
export async function guard(fn: () => Promise<void>): Promise<boolean> {
  try {
    app.error = "";
    await fn();
    return true;
  } catch (e) {
    app.error = message(e);
    return false;
  }
}
export const dismissError = () => void (app.error = "");

const ME_CACHE = "me";

// Offline the last known user stands in, so a reload in a dead spot still shows the stored session.
export async function init() {
  syncSheet();
  try {
    app.me = await api.getMe();
    save(ME_CACHE, app.me);
  } catch (e) {
    if (e instanceof ApiError && e.offline) app.me = load<Me>(ME_CACHE);
    if (!app.me) app.error = message(e);
  }
  app.ready = true;
}

// The start page shows the open session and the latest few; the history page loads its own pages.
const START_SESSIONS = 6;

export const refreshSessions = () =>
  guard(async () => {
    app.sessions = await api.listSessions(START_SESSIONS);
  });

// The stored copy stands in when the server cannot be reached (dead spot in the gym), so the page still shows.
export async function loadSession(id: string) {
  if (app.session?.id !== id) app.session = null;
  try {
    app.error = "";
    setSession(await api.getSession(id));
  } catch (e) {
    const cached = load<SessionTree>(SESSION_CACHE);
    if (e instanceof ApiError && e.offline && cached?.id === id) {
      app.session = cached;
      app.stale = true; // the offline notice says it all
    } else {
      app.error = message(e);
    }
  }
}

// Block changes answer with the whole session, which simply replaces what is shown.
export const changeSession = (fn: () => Promise<SessionTree>) => guard(async () => setSession(await fn()));

export const startSession = () =>
  guard(async () => {
    const tree = await api.createSession();
    setSession(tree);
    navigate(paths.session(tree.id));
  });

// A past training entered afterwards: it starts at the given time and is ended right away (at its start, the only time
// known), so it neither shows as running nor ends at "now" when "Fertig" is tapped. It stays fully editable.
// Creating it ends an open session (server rule: one open session).
export const logPastSession = (startedAt: string, title: string) =>
  guard(async () => {
    const created = await api.createSession({ started_at: startedAt, title: title.trim() || null });
    setSession(await api.updateSession(created.id, { ended_at: startedAt }));
    closeSheetThen(() => navigate(paths.session(created.id)));
  });

// Ends the session now (only if it is still open) and goes to the start.
export const finishSession = (tree: SessionTree) =>
  guard(async () => {
    if (tree.ended_at === null) setSession(await api.updateSession(tree.id, { ended_at: new Date().toISOString() }));
    goUp(paths.start());
  });

function exerciseSets(blockExerciseId: string): SetLog[] | null {
  for (const block of app.session?.blocks ?? []) {
    for (const be of block.exercises) if (be.id === blockExerciseId) return be.sets;
  }
  return null;
}

// Puts `replacement` (one set, or none to delete) where the set `id` is in the shown session.
function replaceSet(blockExerciseId: string, id: string, replacement: SetLog[]) {
  const sets = exerciseSets(blockExerciseId);
  const index = sets?.findIndex((s) => s.id === id) ?? -1;
  if (sets && index >= 0) sets.splice(index, 1, ...replacement);
  cacheSession();
}

// Sets answer with themselves only; they are put into the shown session instead of loading it again.
export const addSets = (blockExerciseId: string, sets: SetInput[]) =>
  guard(async () => {
    const created = await api.addSets(blockExerciseId, sets);
    exerciseSets(blockExerciseId)?.push(...created);
    cacheSession();
  });

export const updateSet = (blockExerciseId: string, id: string, patch: SetInput) =>
  guard(async () => {
    const updated = await api.updateSet(id, patch);
    replaceSet(blockExerciseId, id, [updated]);
  });

export const deleteSet = (blockExerciseId: string, id: string) =>
  guard(async () => {
    await api.deleteSet(id);
    replaceSet(blockExerciseId, id, []);
  });


// Sheets: an open sheet owns one history entry (same URL), so "back" (Android button or gesture) closes it instead of
// leaving the page. The sheet lives in that entry's state: coming back from "Übung anlegen" opens it again as it was.
const sheetInEntry = () => (history.state as { sheet?: SheetState } | null)?.sheet;

function syncSheet() {
  app.sheet = sheetInEntry() ?? { kind: "none" };
}

window.addEventListener("popstate", syncSheet);
window.addEventListener("hashchange", syncSheet);

export function openSheet(sheet: SheetState) {
  app.error = "";
  if (app.sheet.kind === "none") history.pushState({ sheet }, "");
  else history.replaceState({ sheet }, "");
  app.sheet = sheet;
}

// Keeps the sheet's entry up to date (e.g. the search text), so returning to it restores it.
export function rememberSheet(sheet: SheetState) {
  history.replaceState({ sheet: $state.snapshot(sheet) }, "");
}

// Closes the sheet, then moves on once its history entry is gone (a navigation right away would race the
// history.back() and be undone by it).
export function closeSheetThen(next: () => void) {
  if (!sheetInEntry()) {
    app.sheet = { kind: "none" };
    next();
    return;
  }
  window.addEventListener("popstate", () => next(), { once: true });
  closeSheet();
}

export function closeSheet() {
  if (app.sheet.kind === "none") return;
  app.sheet = { kind: "none" };
  if (sheetInEntry()) history.back();
}
