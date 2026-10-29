import type { SessionExercise, SetLog, SetValues } from "../types.ts";

const values = (set: SetLog): SetValues => ({
  weight_kg: set.weight_kg,
  reps: set.reps,
  duration_s: set.duration_s,
  distance_m: set.distance_m,
});

const EMPTY: SetValues = { weight_kg: null, reps: null, duration_s: null, distance_m: null };

// What the "next set" row starts with: the previous set of this session, else the first set of last time, else empty.
// Only the numbers are copied; MAX and the note belong to the set they were given to. While planned sets are left, the
// plan comes first: its weight and the upper bound of each target (5–6 reps → 6); what it leaves open (a max set
// has no reps) falls back to that rule.
export function draftFor(exercise: SessionExercise): SetValues {
  const source = exercise.sets.at(-1) ?? exercise.last_time?.sets[0];
  const base = source ? values(source) : EMPTY;
  const plan = exercise.planned;
  if (!plan || exercise.sets.length >= (plan.sets?.[1] ?? 1)) return base;
  return {
    weight_kg: plan.weight_kg ?? base.weight_kg,
    reps: plan.reps?.[1] ?? base.reps,
    duration_s: plan.duration_s?.[1] ?? base.duration_s,
    distance_m: plan.distance_m?.[1] ?? base.distance_m,
  };
}
