import { goto } from "$app/navigation";
import { page } from "$app/state";
import { untrack } from "svelte";
import * as api from "./api";
import { ApiError } from "./api";
import { goUp, navigate, paths } from "./router.svelte";
import { load, save } from "./storage";
import type { PlanTarget } from "./logic/plan-edit";
import type { Me, SessionSummary, SessionTree, SetInput, SetLog } from "./types";

// Where the "add exercise" sheet puts the exercise it is given.
export type AddTarget = { sessionId: string; blockId: string | null; openAfter: boolean }; // blockId null = new block

export type SheetState =
  | { kind: "none" }
  | { kind: "add-exercise"; target: AddTarget; query: string }
  | { kind: "session"; sessionId: string }
  | { kind: "block-menu"; sessionId: string; blockId: string }
  | { kind: "log-session" }
  | { kind: "log-planned"; plannedId: string }
  | { kind: "plan-edit"; target: PlanTarget };

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

// A past training entered afterwards: created already ended (at its start, the only time known), so it neither shows
// as running nor ends at "now" when "Fertig" is tapped, and an open session keeps running. It stays fully editable.
export const logPastSession = (startedAt: string, title: string) =>
  guard(async () => {
    const created = await api.createSession({ started_at: startedAt, ended_at: startedAt, title: title.trim() || null });
    setSession(created);
    closeSheetThen(() => navigate(paths.session(created.id)));
  });

// A session from a planned session: one block per plan line. Without times it starts now (and ends an open session);
// with startedAt it is entered afterwards, done at once, like "Nachtragen" on the start page.
export const startPlanned = (plannedId: string, startedAt?: string) =>
  guard(async () => {
    const tree = await api.startPlannedSession(plannedId, startedAt ? { started_at: startedAt, ended_at: startedAt } : {});
    setSession(tree);
    if (startedAt) closeSheetThen(() => navigate(paths.session(tree.id)));
    else navigate(paths.session(tree.id));
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

function blockExercise(blockExerciseId: string) {
  for (const block of app.session?.blocks ?? []) {
    for (const be of block.exercises) if (be.id === blockExerciseId) return be;
  }
  return null;
}

// A set on a test line of the plan makes (or moves, or removes) a test value on the server, which the set's own answer
// does not carry: fetch just that part of the session. The set is saved either way, so a failure here stays silent.
async function refreshTest(blockExerciseId: string) {
  const shown = blockExercise(blockExerciseId);
  if (!shown?.planned?.test_kind || !app.session) return;
  try {
    const fresh = (await api.getSession(app.session.id)).blocks.flatMap((b) => b.exercises).find((e) => e.id === blockExerciseId);
    if (fresh) shown.planned = fresh.planned;
  } catch {
    // keep the test shown so far
  }
}

// Sets answer with themselves only; they are put into the shown session instead of loading it again.
export const addSets = (blockExerciseId: string, sets: SetInput[]) =>
  guard(async () => {
    const created = await api.addSets(blockExerciseId, sets);
    exerciseSets(blockExerciseId)?.push(...created);
    await refreshTest(blockExerciseId);
    cacheSession();
  });

export const updateSet = (blockExerciseId: string, id: string, patch: SetInput) =>
  guard(async () => {
    const updated = await api.updateSet(id, patch);
    replaceSet(blockExerciseId, id, [updated]);
    await refreshTest(blockExerciseId);
  });

export const deleteSet = (blockExerciseId: string, id: string) =>
  guard(async () => {
    await api.deleteSet(id);
    replaceSet(blockExerciseId, id, []);
    await refreshTest(blockExerciseId);
  });


// Sheets: an open sheet owns one history entry (same URL, SvelteKit's shallow routing), so "back" (Android button or
// gesture) closes it instead of leaving the page. The sheet lives in that entry's page.state: coming back from
// "Übung anlegen" opens it again as it was.
const NO_SHEET: SheetState = { kind: "none" };
const sheetInEntry = () => page.state.sheet;

// back/forward changes page.state; app.sheet follows it. untrack: openSheet sets app.sheet ahead of the navigation,
// that must not count as a change of the entry.
$effect.root(() => {
  $effect(() => {
    const next = page.state.sheet ?? NO_SHEET;
    untrack(() => {
      if (JSON.stringify(next) !== JSON.stringify($state.snapshot(app.sheet))) app.sheet = next;
    });
  });
});

const currentHash = () => location.hash || paths.start();

export function openSheet(sheet: SheetState) {
  app.error = "";
  const replacing = app.sheet.kind !== "none";
  app.sheet = sheet;
  void goto(currentHash(), { shallow: true, replace: replacing, persistState: true, state: { sheet: $state.snapshot(sheet) } });
}

// Keeps the sheet's entry up to date (e.g. the search text), so returning to it restores it.
export function rememberSheet(sheet: SheetState) {
  void goto(currentHash(), { shallow: true, replace: true, persistState: true, state: { sheet: $state.snapshot(sheet) } });
}

// Closes the sheet, then moves on once its history entry is gone (a navigation right away would race the
// history.back() and be undone by it).
export function closeSheetThen(next: () => void) {
  if (!sheetInEntry()) {
    app.sheet = NO_SHEET;
    next();
    return;
  }
  window.addEventListener("popstate", () => next(), { once: true });
  closeSheet();
}

export function closeSheet() {
  if (app.sheet.kind === "none") return;
  app.sheet = NO_SHEET;
  if (sheetInEntry()) history.back();
}
