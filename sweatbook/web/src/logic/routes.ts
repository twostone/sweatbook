// Hash routes of the app. Pure, so they are tested; router.svelte.ts ties them to the browser.

export type Route =
  | { name: "start" }
  | { name: "history" }
  | { name: "session"; sessionId: string }
  | { name: "block"; sessionId: string; blockId: string }
  | { name: "catalog" }
  | { name: "exercise"; exerciseId: string }
  // fromSheet: opened from "add exercise", so saving returns there with the new exercise picked
  | { name: "new-exercise"; prefill: string; fromSheet: boolean };

export const paths = {
  start: () => "#/",
  history: () => "#/history",
  session: (sessionId: string) => `#/s/${sessionId}`,
  block: (sessionId: string, blockId: string) => `#/s/${sessionId}/b/${blockId}`,
  catalog: () => "#/exercises",
  exercise: (exerciseId: string) => `#/exercises/${exerciseId}`,
  newExercise: (prefill: string, fromSheet = false) =>
    `#/exercises/new?${new URLSearchParams({ name: prefill, ...(fromSheet ? { from: "sheet" } : {}) })}`,
};

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "s" && parts[1]) {
    if (parts[2] === "b" && parts[3]) return { name: "block", sessionId: parts[1], blockId: parts[3] };
    return { name: "session", sessionId: parts[1] };
  }
  if (parts[0] === "history") return { name: "history" };
  if (parts[0] === "exercises") {
    if (parts[1] === "new") {
      const params = new URLSearchParams(query);
      return { name: "new-exercise", prefill: params.get("name") ?? "", fromSheet: params.get("from") === "sheet" };
    }
    return parts[1] ? { name: "exercise", exerciseId: parts[1] } : { name: "catalog" };
  }
  return { name: "start" };
}
