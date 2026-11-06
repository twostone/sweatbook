// Muscle groups an exercise works, a fixed list so evaluations add up (free text would split "Brust" and "Brustmuskel").
// Keys are English (code, MCP); the German labels live in the web client. The order is anatomical, top to bottom, and is
// the order the API returns them in. A new group is a code change only: the table has no CHECK on the name on purpose.
export const MUSCLES = [
  "chest",
  "upper_back",
  "lats",
  "lower_back",
  "front_delts",
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps",
  "forearms",
  "core",
  "glutes",
  "quads",
  "hamstrings",
  "calves",
  "adductors",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export type MuscleRole = "primary" | "secondary";
export type Muscles = { primary: Muscle[]; secondary: Muscle[] };
export const noMuscles = (): Muscles => ({ primary: [], secondary: [] });

// "Weighted sets": a set counts fully for the muscles an exercise mainly works and half for the ones that assist. A common
// rule of thumb in hypertrophy training, not a measurement.
export const PRIMARY_WEIGHT = 1;
export const SECONDARY_WEIGHT = 0.5;

export type MuscleCount = { muscle: Muscle; sets: number; primary_sets: number; secondary_sets: number };
// untagged_sets: sets of exercises without any muscle group, so a gap in the catalog shows instead of hiding.
export type MuscleSummary = { muscles: MuscleCount[]; untagged_sets: number };

const canonical = (muscles: Iterable<Muscle>): Muscle[] => {
  const set = new Set(muscles);
  return MUSCLES.filter((m) => set.has(m));
};

// Duplicates dropped, canonical order. A group with both roles is refused (null), the caller decides the error.
export function normalizeMuscles(muscles: Muscles): Muscles | null {
  const primary = canonical(muscles.primary);
  const secondary = canonical(muscles.secondary);
  return primary.some((m) => secondary.includes(m)) ? null : { primary, secondary };
}

// The muscle summary of a session tree, from the muscle groups each exercise carries in it. Not part of the tree itself:
// sets answer with themselves only, so the web client derives it the same way (web/src/logic/muscles.ts) to stay current.
export function sessionMuscles(blocks: readonly { exercises: readonly { exercise: { id: string; muscles: Muscles }; sets: readonly unknown[] }[] }[]): MuscleSummary {
  const exercises = blocks.flatMap((b) => b.exercises);
  const musclesById = new Map(exercises.map((be) => [be.exercise.id, be.exercise.muscles]));
  const sets = exercises.flatMap((be) => be.sets.map(() => ({ exercise_id: be.exercise.id })));
  return muscleSummary(sets, (id) => musclesById.get(id) ?? noMuscles());
}

// Weighted sets per muscle group over the given sets, most trained first; groups without sets are left out.
export function muscleSummary(sets: readonly { exercise_id: string }[], musclesOf: (exerciseId: string) => Muscles): MuscleSummary {
  const counts = new Map<Muscle, MuscleCount>();
  const count = (muscle: Muscle) => {
    let c = counts.get(muscle);
    if (!c) counts.set(muscle, (c = { muscle, sets: 0, primary_sets: 0, secondary_sets: 0 }));
    return c;
  };
  let untagged = 0;
  for (const s of sets) {
    const m = musclesOf(s.exercise_id);
    if (!m.primary.length && !m.secondary.length) untagged++;
    for (const muscle of m.primary) {
      count(muscle).primary_sets++;
      count(muscle).sets += PRIMARY_WEIGHT;
    }
    for (const muscle of m.secondary) {
      count(muscle).secondary_sets++;
      count(muscle).sets += SECONDARY_WEIGHT;
    }
  }
  const order = (m: Muscle) => MUSCLES.indexOf(m);
  return { muscles: [...counts.values()].sort((a, b) => b.sets - a.sets || order(a.muscle) - order(b.muscle)), untagged_sets: untagged };
}

// A change to one or both lists, as tools send it: a given list replaces its role, and a group named there leaves the
// other role (moving "triceps" to primary needs no second list). Nothing given = no change (undefined).
export function replaceRoles(current: Muscles, primary?: Muscle[], secondary?: Muscle[]): Muscles | undefined {
  if (primary === undefined && secondary === undefined) return undefined;
  const nextPrimary = primary ?? current.primary.filter((m) => !secondary!.includes(m));
  const nextSecondary = secondary ?? current.secondary.filter((m) => !primary!.includes(m));
  return { primary: nextPrimary, secondary: nextSecondary };
}
