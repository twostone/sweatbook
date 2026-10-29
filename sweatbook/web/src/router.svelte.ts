// Navigation on top of SvelteKit's hash router (kit.router.type "hash"), so the back button and a reload work on every
// level inside the HA ingress iframe (the iframe's history entries share the tab's history). Relative API URLs are
// unaffected by the hash. The routes themselves are the files under routes/; their paths are in logic/routes.ts.

import { goto } from "$app/navigation";
import { paths } from "./logic/routes";

export { paths } from "./logic/routes";

// Hashes this page pushed, so "up" can go back instead of piling up entries. Lost on reload, then "up" replaces.
const trail: string[] = [];

export function navigate(hash: string) {
  if (hash === location.hash) return;
  trail.push(location.hash || paths.start());
  void goto(hash);
}

// Between siblings (the next or previous block): no new entry, so "back" still leads up to the overview.
export function replace(hash: string) {
  void goto(hash, { replace: true });
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

window.addEventListener("popstate", () => {
  if (trail.at(-1) === location.hash) trail.pop(); // the user went back up on their own
});
