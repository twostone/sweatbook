// Hash routes of the app. Pure, so they are tested; router.svelte.ts ties them to the browser.

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
