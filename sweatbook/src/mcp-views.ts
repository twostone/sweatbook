import type * as z from "zod";
import type { ExerciseTest } from "./data/tests.ts";
import type { Exercise } from "./data/exercises.ts";
import type { PlanItem, Range } from "./data/plan.ts";
import type { ProgramSummary, ProgramTree } from "./data/programs.ts";
import type { HistoryEntry, SessionSummary, SessionTree } from "./data/sessions.ts";
import type { SetLog } from "./data/sets.ts";
import type * as schemas from "./mcp-schemas.ts";

// Data objects -> the compact shapes of mcp-schemas.ts. Pure; the text is built here so a model never has to read
// raw columns to understand a set or a plan line.
type View<T extends z.ZodType> = z.infer<T>;

const num = (n: number) => String(Math.round(n * 100) / 100);
const rangeText = ([min, max]: Range) => (min === max ? num(min) : `${num(min)}–${num(max)}`);

// "100 kg" for added weight, nothing for bodyweight; reps, distance and time as they are.
function setText(s: Pick<SetLog, "weight_kg" | "reps" | "distance_m" | "duration_s" | "is_max">): string {
  const value = [s.reps !== null ? num(s.reps) : null, s.distance_m !== null ? `${num(s.distance_m)} m` : null, s.duration_s !== null ? `${num(s.duration_s)} s` : null]
    .filter((v) => v !== null)
    .join(" ");
  return `${value}${s.weight_kg !== null ? ` @ ${num(s.weight_kg)} kg` : ""}${s.is_max ? " (max)" : ""}`;
}

// Neighbouring equal sets are counted: "3×5 @ 100 kg, 1×4 @ 100 kg".
export function summarizeSets(sets: Pick<SetLog, "weight_kg" | "reps" | "distance_m" | "duration_s" | "is_max">[]): string {
  if (sets.length === 0) return "no sets";
  const groups: { text: string; n: number }[] = [];
  for (const s of sets) {
    const text = setText(s);
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.n++;
    else groups.push({ text, n: 1 });
  }
  return groups.map((g) => `${g.n}×${g.text}`).join(", ");
}

// The target of a plan line: "3×5–8 @ 80 kg (70 % of Kniebeuge); rest 2 min". A note line is just its note.
export function planText(item: PlanItem): string {
  if (!item.exercise) return item.note ?? item.label ?? "";
  const count = item.sets ? `${rangeText(item.sets)}×` : "";
  const value = item.to_max ? "max" : item.reps ? rangeText(item.reps) : item.distance_m ? `${rangeText(item.distance_m)} m` : item.duration_s ? `${rangeText(item.duration_s)} s` : "";
  const share = item.load_pct !== null && item.load_ref ? `${num(item.load_pct)} % of ${item.load_ref.name}` : null;
  const load = item.weight_kg !== null ? ` @ ${num(item.weight_kg)} kg${share ? ` (${share})` : ""}` : item.load_kg !== null ? ` @ ${num(item.load_kg)} kg` : share ? ` @ ${share} (no 1RM yet)` : "";
  const test = item.test_kind === "one_rm" ? "1RM test" : item.test_kind === "best" ? "best-performance test" : null;
  return [`${count}${value}${load}`.trim(), item.label, item.rest ? `rest ${item.rest}` : null, test].filter((p) => p).join("; ");
}

// A 1RM is just a weight; a best is a set ("58 @ 45 kg", "74 s").
const testText = (t: Pick<ExerciseTest, "kind" | "weight_kg" | "reps" | "distance_m" | "duration_s">) => {
  const hasValue = t.reps !== null || t.distance_m !== null || t.duration_s !== null;
  const result = hasValue || t.weight_kg === null ? setText({ ...t, is_max: false }) : `${num(t.weight_kg)} kg`;
  return `${t.kind === "one_rm" ? "1RM" : "best"} ${result}`;
};

export const setView = (s: SetLog): View<typeof schemas.setView> => ({
  id: s.id,
  weight_kg: s.weight_kg,
  reps: s.reps,
  duration_s: s.duration_s,
  distance_m: s.distance_m,
  is_max: s.is_max,
  note: s.note,
});

export const exerciseView = (e: Exercise): View<typeof schemas.exerciseView> => ({
  id: e.id,
  name: e.name,
  fields: e.fields,
  aliases: e.aliases,
  archived: e.archived,
  note: e.note,
});

export const sessionView = (t: SessionTree): View<typeof schemas.sessionView> => ({
  id: t.id,
  title: t.title,
  started_at: t.started_at,
  ended_at: t.ended_at,
  open: t.ended_at === null,
  note: t.note,
  plan: t.plan && { program: t.plan.program_name, week: t.plan.week, phase: t.plan.phase, label: t.plan.label, notes: t.plan.notes },
  exercises: t.blocks.flatMap((b) =>
    b.exercises.map((e) => ({
      block_id: b.id,
      block_exercise_id: e.id,
      exercise_id: e.exercise.id,
      name: e.exercise.name,
      note: e.note,
      summary: summarizeSets(e.sets),
      sets: e.sets.map(setView),
      planned: e.planned ? planText(e.planned) : null,
      last_time: e.last_time && { started_at: e.last_time.started_at, summary: summarizeSets(e.last_time.sets) },
    })),
  ),
});

export const sessionListItem = (s: SessionSummary): View<typeof schemas.sessionListItem> => ({
  id: s.id,
  title: s.title,
  started_at: s.started_at,
  ended_at: s.ended_at,
  open: s.ended_at === null,
  note: s.note,
  exercise_count: s.block_count,
  set_count: s.set_count,
});

export const testView = (t: ExerciseTest & { exercise_name?: string }): View<typeof schemas.testView> => ({
  id: t.id,
  exercise_id: t.exercise_id,
  exercise: t.exercise_name ?? null,
  kind: t.kind,
  tested_on: t.tested_on,
  text: testText(t),
  note: t.note,
});

export const programListItem = (p: ProgramSummary): View<typeof schemas.programListItem> => ({
  id: p.id,
  name: p.name,
  start_date: p.start_date,
  archived: p.archived,
  shared: p.shared,
  owned: p.owned,
  joined: p.joined,
  owner_name: p.owner_name,
  progress: { done: p.done, total: p.total },
  next: p.next && { planned_session_id: p.next.planned_session_id, week: p.next.week, phase: p.next.phase, label: p.next.label },
});

export const programView = (p: ProgramTree): View<typeof schemas.programView> => ({
  ...programListItem(p),
  phases: p.phases.map((ph) => ({ id: ph.id, name: ph.name, note: ph.note })),
  weeks: p.weeks.map((w) => ({
    id: w.id,
    number: w.number,
    phase: w.phase,
    deload: w.deload,
    sessions: w.sessions.map((s) => ({
      id: s.id,
      label: s.label,
      state: s.state,
      skip_note: s.skip_note,
      session_id: s.session_id,
      rows: s.items.map((i) => ({ id: i.id, exercise: i.exercise?.name ?? null, text: planText(i), note: i.exercise ? i.note : null })),
    })),
  })),
  tests: p.tests.map(testView),
});

export const historyView = (entries: HistoryEntry[]): View<typeof schemas.historyView> => ({
  sessions: entries.map((e) => ({ session_id: e.session_id, title: e.title, started_at: e.started_at, summary: summarizeSets(e.sets), sets: e.sets.map(setView) })),
});
