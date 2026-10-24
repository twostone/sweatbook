import type { SessionExercise, SetLog, SetValues } from "../types.ts";

const values = (set: SetLog): SetValues => ({ weight_kg: set.weight_kg, reps: set.reps, duration_s: set.duration_s });

// What the "next set" row starts with: the previous set of this session, else the first set of last time, else empty.
// Only the numbers are copied; MAX and the note belong to the set they were given to.
export function draftFor(exercise: SessionExercise): SetValues {
  const source = exercise.sets.at(-1) ?? exercise.last_time?.sets[0];
  return source ? values(source) : { weight_kg: null, reps: null, duration_s: null };
}
