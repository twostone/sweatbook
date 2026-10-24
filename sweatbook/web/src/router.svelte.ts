// Hash routes, so the back button and a reload work on every level inside the HA ingress iframe (the iframe's
// history entries share the tab's history). Relative API URLs are unaffected by the hash.

export type Route =
  | { name: "start" }
  | { name: "session"; sessionId: string }
  | { name: "block"; sessionId: string; blockId: string }
  | { name: "new-exercise"; prefill: string };

export const paths = {
  start: () => "#/",
  session: (sessionId: string) => `#/s/${sessionId}`,
  block: (sessionId: string, blockId: string) => `#/s/${sessionId}/b/${blockId}`,
  newExercise: (prefill: string) => `#/exercises/new?name=${encodeURIComponent(prefill)}`,
};

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "s" && parts[1]) {
    if (parts[2] === "b" && parts[3]) return { name: "block", sessionId: parts[1], blockId: parts[3] };
    return { name: "session", sessionId: parts[1] };
  }
  if (parts[0] === "exercises" && parts[1] === "new") {
    return { name: "new-exercise", prefill: new URLSearchParams(query).get("name") ?? "" };
  }
  return { name: "start" };
}

export const router = $state({ route: parseRoute(location.hash) });

// Hashes this page pushed, so "up" can go back instead of piling up entries. Lost on reload, then "up" replaces.
const trail: string[] = [];

export function navigate(hash: string) {
  if (hash === location.hash) return;
  trail.push(location.hash || paths.start());
  location.hash = hash;
}

// Between siblings (the next or previous block): no new entry, so "back" still leads up to the overview.
export function replace(hash: string) {
  location.replace(hash);
}

// Up to a parent page: back if that is where we came from, else replace.
export function goUp(hash: string) {
  if (trail.at(-1) === hash) {
    trail.pop();
    history.back();
  } else {
    replace(hash);
  }
}

// Turns the current history entry (an open sheet's) into the page at `hash`: "back" then leads to where the sheet was
// opened, and no pending history.back() can race the navigation.
export function replaceEntry(hash: string) {
  trail.push(location.hash || paths.start());
  history.replaceState(null, "", hash);
  syncRoute();
}

function syncRoute() {
  router.route = parseRoute(location.hash);
}

window.addEventListener("hashchange", syncRoute);
window.addEventListener("popstate", () => {
  if (trail.at(-1) === location.hash) trail.pop(); // the user went back up on their own
  syncRoute();
});
