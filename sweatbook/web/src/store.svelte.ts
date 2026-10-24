import * as api from "./api";
import { ApiError } from "./api";
import { goUp, navigate, paths, replaceEntry } from "./router.svelte";
import { load, remove, save } from "./storage";
import type { Me, SessionSummary, SessionTree, SetInput, SetLog } from "./types";

// Where the "add exercise" sheet puts the exercise it is given.
export type AddTarget = { sessionId: string; blockId: string | null; openAfter: boolean }; // blockId null = new block

export type SheetState =
  | { kind: "none" }
  | { kind: "add-exercise"; target: AddTarget; query: string }
  | { kind: "session"; sessionId: string }
  | { kind: "block-menu"; sessionId: string; blockId: string };

export const app = $state({
  ready: false,
  me: null as Me | null,
  session: null as SessionTree | null,
  sessions: [] as SessionSummary[],
  // The session on screen is the stored copy, the server could not be reached.
  stale: false,
  error: "",
  sheet: { kind: "none" } as SheetState,
  // Set by "Übung anlegen" before it returns to the sheet, which then shows the new exercise first.
  createdExerciseId: null as string | null,
});

const SESSION_CACHE = "session";

function setSession(tree: SessionTree) {
  app.session = tree;
  app.stale = false;
  save(SESSION_CACHE, tree);
}

// Runs an action and shows its error instead of throwing. Returns success.
export async function guard(fn: () => Promise<void>): Promise<boolean> {
  try {
    app.error = "";
    await fn();
    return true;
  } catch (e) {
    app.error = e instanceof Error ? e.message : String(e);
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
    if (!app.me) app.error = e instanceof Error ? e.message : String(e);
  }
  app.ready = true;
}

export const refreshSessions = () =>
  guard(async () => {
    app.sessions = await api.listSessions();
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
      app.error = e instanceof Error ? e.message : String(e);
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

// Sets answer with themselves only; they are put into the shown session instead of loading it again.
export const addSets = (blockExerciseId: string, sets: SetInput[]) =>
  guard(async () => {
    const created = await api.addSets(blockExerciseId, sets);
    exerciseSets(blockExerciseId)?.push(...created);
    if (app.session) save(SESSION_CACHE, $state.snapshot(app.session));
  });

export const updateSet = (blockExerciseId: string, id: string, patch: SetInput) =>
  guard(async () => {
    const updated = await api.updateSet(id, patch);
    const sets = exerciseSets(blockExerciseId);
    const index = sets?.findIndex((s) => s.id === id) ?? -1;
    if (sets && index >= 0) sets[index] = updated;
    if (app.session) save(SESSION_CACHE, $state.snapshot(app.session));
  });

export const deleteSet = (blockExerciseId: string, id: string) =>
  guard(async () => {
    await api.deleteSet(id);
    const sets = exerciseSets(blockExerciseId);
    const index = sets?.findIndex((s) => s.id === id) ?? -1;
    if (sets && index >= 0) sets.splice(index, 1);
    if (app.session) save(SESSION_CACHE, $state.snapshot(app.session));
  });

// Unsent text of a set row (draft row "draft:<block_exercise id>", edited set "edit:<set id>").
export const loadRow = <T>(key: string) => load<T>(`row:${key}`);
export const saveRow = (key: string, row: unknown) => save(`row:${key}`, row);
export const clearRow = (key: string) => remove(`row:${key}`);

// Sheets: an open sheet owns one history entry (same URL), so "back" (Android button or gesture) closes it instead of
// leaving the page. The sheet lives in that entry's state: coming back from "Übung anlegen" opens it again as it was.
function syncSheet() {
  const state = history.state as { sheet?: SheetState } | null;
  app.sheet = state?.sheet ?? { kind: "none" };
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

// Closes the sheet and opens a page in one step (closeSheet's history.back() would race a navigation).
export function closeSheetAndNavigate(hash: string) {
  const inSheetEntry = Boolean((history.state as { sheet?: unknown } | null)?.sheet);
  app.sheet = { kind: "none" };
  if (inSheetEntry) replaceEntry(hash);
  else navigate(hash);
}

export function closeSheet() {
  if (app.sheet.kind === "none") return;
  app.sheet = { kind: "none" };
  if ((history.state as { sheet?: unknown } | null)?.sheet) history.back();
}
