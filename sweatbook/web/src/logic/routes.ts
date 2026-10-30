// Hash paths of the app's pages. The routes themselves are the files under web/src/routes/; keep both in step.
// Pure, so they are tested; router.svelte.ts ties them to the browser.

export const paths = {
  start: () => "#/",
  history: () => "#/history",
  session: (sessionId: string) => `#/s/${sessionId}`,
  block: (sessionId: string, blockId: string) => `#/s/${sessionId}/b/${blockId}`,
  catalog: () => "#/exercises",
  profile: () => "#/profile",
  programs: () => "#/programs",
  programImport: () => "#/programs/import",
  program: (programId: string) => `#/programs/${programId}`,
  plannedSession: (programId: string, plannedId: string) => `#/programs/${programId}/s/${plannedId}`,
  exercise: (exerciseId: string) => `#/exercises/${exerciseId}`,
  // fromSheet: opened from "add exercise", so saving returns there with the new exercise picked
  newExercise: (prefill: string, fromSheet = false) =>
    `#/exercises/new?${new URLSearchParams({ name: prefill, ...(fromSheet ? { from: "sheet" } : {}) })}`,
};

// The query of a hash route ("#/exercises/new?name=x"): with the hash router it lies inside page.url.hash.
export const hashQuery = (hash: string) => new URLSearchParams(hash.split("?")[1] ?? "");
