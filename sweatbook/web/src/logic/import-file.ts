// The program import: reading the chosen file, telling a rejection in words, counting what a dry run found.

export type ImportCounts = { weeks: number; sessions: number; lines: number; tests: number };

type PreviewProgram = { weeks: { sessions: { items: unknown[] }[] }[]; tests: unknown[] };

export function countImport(program: PreviewProgram): ImportCounts {
  const sessions = program.weeks.flatMap((w) => w.sessions);
  return { weeks: program.weeks.length, sessions: sessions.length, lines: sessions.reduce((n, s) => n + s.items.length, 0), tests: program.tests.length };
}

// The text of a file as the request body, or null when it is not JSON.
export function parseImportFile(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type Issue = { path?: unknown[]; message?: string };

// What a 400 on the import says: the server's own sentence for a rule of the plan ("week 2 A, line 2: …"), or the first
// place the file does not fit the format (zod issues, sent as a JSON string in error.message).
export function importErrorText(detail: Record<string, unknown>): string {
  const error = detail.error;
  if (typeof error === "string") return error;
  const raw = error && typeof error === "object" ? (error as { message?: unknown }).message : null;
  if (typeof raw === "string") {
    try {
      const issue = (JSON.parse(raw) as Issue[])[0];
      if (issue) return `${(issue.path ?? []).slice(1).join(" › ") || "Datei"}: ${issue.message ?? "ungültig"}`;
    } catch {
      // fall through
    }
  }
  return "Die Datei passt nicht zum Format.";
}
