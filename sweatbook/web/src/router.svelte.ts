// Hash routes, so the back button and a reload work on every level inside the HA ingress iframe (the iframe's
// history entries share the tab's history). Relative API URLs are unaffected by the hash.

import { parseRoute, paths } from "./logic/routes";

export { paths, type Route } from "./logic/routes";

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

// Up to an ancestor page: back as many steps as it lies behind us, so "back" never returns to the pages left (an
// ended or deleted session, a removed block). Not in the trail (after a reload): replace.
export function goUp(hash: string) {
  const index = trail.lastIndexOf(hash);
  if (index === -1) {
    replace(hash);
    return;
  }
  const steps = trail.length - index;
  trail.length = index;
  history.go(-steps);
}

function syncRoute() {
  router.route = parseRoute(location.hash);
}

window.addEventListener("hashchange", syncRoute);
window.addEventListener("popstate", () => {
  if (trail.at(-1) === location.hash) trail.pop(); // the user went back up on their own
  syncRoute();
});
