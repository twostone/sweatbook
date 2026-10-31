import { isoNow, transaction, type Db } from "../db.ts";
import { InvalidError, nameKey, newId } from "./common.ts";
import { assertUsable, insertExercise, listExercises, type Exercise, type Field } from "./exercises.ts";
import type { Range } from "./plan.ts";
import { checkItem, getProgram, insertPlannedSession, insertProgram, resolvePhase, writeItem, type PlanItemInput, type ProgramTree } from "./programs.ts";
import { createTest, type TestKind } from "./tests.ts";

// A whole program from one JSON file (the shape is validated in app.ts; what depends on the catalog, here). Exercises are
// matched by name or alias, missing ones are created. Everything or nothing.
export type ImportLine =
  | { text: string }
  | {
      exercise: string; // key from `exercises`
      label?: string;
      sets?: Range;
      reps?: Range;
      distance_m?: Range;
      duration_s?: Range;
      max?: boolean;
      load?: { kg: number; kg_female?: number } | { percent: number; of: string };
      test?: TestKind;
      rest?: string;
      note?: string;
    };

export type ImportFile = {
  program: { name: string; start_date: string; start_week?: number };
  exercises: { key: string; name: string; fields: Field[] }[];
  tests?: { exercise: string; tested_on: string; kind: TestKind; weight_kg?: number; reps?: number; distance_m?: number; duration_s?: number; note?: string }[];
  weeks: { number: number; phase?: string; deload?: boolean; sessions: { label: string; items: ImportLine[] }[] }[];
};

export type ImportResult = { program: ProgramTree; new_exercises: string[] };

export const PRE_APP_NOTE = "vor der App";

// dryRun: everything is checked and built, then rolled back, so the caller can show what an import would do.
export function importProgram(db: Db, userId: string, file: ImportFile, dryRun = false): ImportResult {
  if (!dryRun) return transaction(db, () => run(db, userId, file));
  db.exec("BEGIN");
  try {
    return run(db, userId, file);
  } finally {
    db.exec("ROLLBACK");
  }
}

function run(db: Db, userId: string, file: ImportFile): ImportResult {
  const existing = listExercises(db, userId);
  const catalog = new Map<string, Exercise>(); // name or alias -> exercise
  for (const e of existing) for (const n of [e.name, ...e.aliases]) catalog.set(nameKey(n), e);
  const ids = new Map<string, string>(); // key in the file -> exercise id
  const newExercises: string[] = [];
  for (const e of file.exercises) {
    if (ids.has(e.key)) throw new InvalidError(`exercises: key "${e.key}" twice`);
    const found = catalog.get(nameKey(e.name));
    if (found) assertUsable(found);
    else newExercises.push(e.name);
    ids.set(e.key, found?.id ?? insertExercise(db, userId, { name: e.name, fields: e.fields }));
  }
  const exerciseId = (key: string, where: string): string => {
    const id = ids.get(key);
    if (id === undefined) throw new InvalidError(`${where}: unknown exercise "${key}"`);
    return id;
  };

  const programId = insertProgram(db, userId, { name: file.program.name, start_date: file.program.start_date });

  file.tests?.forEach((t, i) => {
    const where = `tests[${i}]`;
    try {
      createTest(db, userId, exerciseId(t.exercise, where), t);
    } catch (e) {
      throw e instanceof InvalidError && !e.message.startsWith(where) ? new InvalidError(`${where}: ${e.message}`) : e;
    }
  });

  const seen = new Set<number>();
  const startWeek = file.program.start_week ?? 1;
  const skip = db.prepare("INSERT INTO planned_session_skip (planned_session_id, user_id, skipped_at, skip_note) VALUES (?, ?, ?, ?)");
  for (const week of [...file.weeks].sort((a, b) => a.number - b.number)) {
    if (seen.has(week.number)) throw new InvalidError(`weeks: number ${week.number} twice`);
    seen.add(week.number);
    const weekId = newId();
    db.prepare("INSERT INTO program_week (id, program_id, number, phase_id, deload) VALUES (?, ?, ?, ?, ?)").run(
      weekId,
      programId,
      week.number,
      resolvePhase(db, programId, week.phase ?? null),
      week.deload ? 1 : 0,
    );
    for (const session of week.sessions) {
      const sessionId = insertPlannedSession(db, weekId, session.label);
      if (week.number < startWeek) skip.run(sessionId, userId, isoNow(), PRE_APP_NOTE);
      session.items.forEach((line, i) => {
        const where = `week ${week.number} ${session.label}, line ${i + 1}`;
        try {
          const input = toInput(line, (key) => exerciseId(key, where));
          checkItem(db, userId, input);
          writeItem(db, sessionId, null, input);
        } catch (e) {
          throw e instanceof InvalidError && !e.message.startsWith(where) ? new InvalidError(`${where}: ${e.message}`) : e;
        }
      });
    }
  }
  return { program: getProgram(db, userId, programId), new_exercises: newExercises };
}

function toInput(line: ImportLine, exerciseId: (key: string) => string): PlanItemInput {
  const empty: PlanItemInput = {
    exercise_id: null,
    label: null,
    sets: null,
    reps: null,
    distance_m: null,
    duration_s: null,
    to_max: false,
    load_kg: null,
    load_kg_female: null,
    load_pct: null,
    load_ref_exercise_id: null,
    test_kind: null,
    rest: null,
    note: null,
  };
  if ("text" in line) return { ...empty, note: line.text };
  const load = line.load;
  return {
    ...empty,
    exercise_id: exerciseId(line.exercise),
    label: line.label ?? null,
    sets: line.sets ?? null,
    reps: line.reps ?? null,
    distance_m: line.distance_m ?? null,
    duration_s: line.duration_s ?? null,
    to_max: line.max ?? false,
    load_kg: load && "kg" in load ? load.kg : null,
    load_kg_female: load && "kg" in load ? (load.kg_female ?? null) : null,
    load_pct: load && "percent" in load ? load.percent : null,
    load_ref_exercise_id: load && "percent" in load ? exerciseId(load.of) : null,
    test_kind: line.test ?? null,
    rest: line.rest ?? null,
    note: line.note ?? null,
  };
}
