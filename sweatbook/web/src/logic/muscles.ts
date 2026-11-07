import type { Muscle, Muscles } from "../types.ts";

// Muscle groups in the client: German labels in the order of the server's list (anatomical, top to bottom), the
// three-way toggle of the exercise form, and the weighted sets of a session, derived like the server does it
// (src/data/muscles.ts; a test keeps both in step), because sets answer with themselves only and the shown session
// would otherwise go stale.
export const MUSCLE_LABELS: Record<Muscle, string> = {
  chest: "Brust",
  upper_back: "Oberer Rücken",
  lats: "Latissimus",
  lower_back: "Unterer Rücken",
  front_delts: "Vordere Schulter",
  side_delts: "Seitliche Schulter",
  rear_delts: "Hintere Schulter",
  biceps: "Bizeps",
  triceps: "Trizeps",
  forearms: "Unterarme",
  core: "Bauch/Rumpf",
  obliques: "Schräge Bauchmuskeln",
  glutes: "Gesäß",
  quads: "Quadrizeps",
  hamstrings: "Beinbeuger",
  calves: "Waden",
  adductors: "Adduktoren",
};
export const MUSCLES = Object.keys(MUSCLE_LABELS) as Muscle[];

export const PRIMARY_WEIGHT = 1;
export const SECONDARY_WEIGHT = 0.5;

export type MuscleRole = "primary" | "secondary" | null;

export const roleOf = (muscles: Muscles, muscle: Muscle): MuscleRole =>
  muscles.primary.includes(muscle) ? "primary" : muscles.secondary.includes(muscle) ? "secondary" : null;

const ordered = (list: Muscle[]) => MUSCLES.filter((m) => list.includes(m));

// One tap moves a group on: not worked -> primary -> secondary -> not worked.
export function cycleRole(muscles: Muscles, muscle: Muscle): Muscles {
  const role = roleOf(muscles, muscle);
  const primary = muscles.primary.filter((m) => m !== muscle);
  const secondary = muscles.secondary.filter((m) => m !== muscle);
  if (role === null) primary.push(muscle);
  else if (role === "primary") secondary.push(muscle);
  return { primary: ordered(primary), secondary: ordered(secondary) };
}

export type MuscleCount = { muscle: Muscle; sets: number; primary_sets: number; secondary_sets: number };
export type MuscleSummary = { muscles: MuscleCount[]; untagged_sets: number };

// Weighted sets per muscle group over all sets of a session, most trained first; untagged_sets are sets of exercises
// without any group. Same rule and order as the server.
// `muscles` may be missing in a session cached before the field existed (storage.ts): counted as untagged then.
export function sessionMuscles(blocks: readonly { exercises: readonly { exercise: { muscles?: Muscles }; sets: readonly unknown[] }[] }[]): MuscleSummary {
  const counts = new Map<Muscle, MuscleCount>();
  const count = (muscle: Muscle) => {
    let c = counts.get(muscle);
    if (!c) counts.set(muscle, (c = { muscle, sets: 0, primary_sets: 0, secondary_sets: 0 }));
    return c;
  };
  let untagged = 0;
  for (const be of blocks.flatMap((b) => b.exercises)) {
    const n = be.sets.length;
    const { primary, secondary } = be.exercise.muscles ?? { primary: [], secondary: [] };
    if (!primary.length && !secondary.length) untagged += n;
    for (const m of primary) {
      count(m).primary_sets += n;
      count(m).sets += n * PRIMARY_WEIGHT;
    }
    for (const m of secondary) {
      count(m).secondary_sets += n;
      count(m).sets += n * SECONDARY_WEIGHT;
    }
  }
  const order = (m: Muscle) => MUSCLES.indexOf(m);
  return { muscles: [...counts.values()].filter((c) => c.sets > 0).sort((a, b) => b.sets - a.sets || order(a.muscle) - order(b.muscle)), untagged_sets: untagged };
}

// Colour steps of the body map (--heat-1 … --heat-4 in app.css); 0 is "not trained". Discrete, because a handful
// of clearly different shades reads better on small shapes than a smooth gradient.
export const HEAT_LEVELS = 4;

// Step of a group relative to the most trained group of the session: anything trained gets at least step 1.
export function heatLevel(sets: number, maxSets: number): number {
  if (sets <= 0 || maxSets <= 0) return 0;
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((sets / maxSets) * HEAT_LEVELS)));
}

// Widths of the two-part bar as fractions of the most trained group: primary sets count full, secondary half.
export function barParts(count: MuscleCount, maxSets: number): { primary: number; secondary: number } {
  if (maxSets <= 0) return { primary: 0, secondary: 0 };
  return { primary: (count.primary_sets * PRIMARY_WEIGHT) / maxSets, secondary: (count.secondary_sets * SECONDARY_WEIGHT) / maxSets };
}

const setsFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
// "4,5 Sätze", "1 Satz"
export const formatWeightedSets = (sets: number) => `${setsFormat.format(sets)} ${sets === 1 ? "Satz" : "Sätze"}`;
