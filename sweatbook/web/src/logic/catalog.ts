import type { Exercise } from "../types.ts";

// Names compare like on the server (nameKey in src/data/common.ts): spaces collapsed, lower case with German rules,
// because SQLite's lower() only knows ASCII.
export const tidy = (text: string) => text.trim().replace(/\s+/g, " ");
export const nameKey = (text: string) => tidy(text).toLocaleLowerCase("de");

const namesOf = (e: Exercise) => [e.name, ...e.aliases].map(nameKey);

// Catalog search: the text anywhere in the name or an alias. Empty matches everything.
export function matches(exercise: Exercise, query: string): boolean {
  const key = nameKey(query);
  return !key || namesOf(exercise).some((n) => n.includes(key));
}

// Shorter words ("KH", "row", "mit") would match half the catalog.
const MIN_WORD_LENGTH = 4;

// The warning while creating or renaming: catalog exercises sharing a word of the typed name, so "Rudern Kabel"
// shows "Rudern vorgebeugt" before a near-duplicate is made. Exact clashes are refused by the server anyway.
export function similarExercises(catalog: Exercise[], name: string, exceptId?: string): Exercise[] {
  const words = nameKey(name)
    .split(" ")
    .filter((w) => w.length >= MIN_WORD_LENGTH);
  if (words.length === 0) return [];
  return catalog.filter((e) => e.id !== exceptId && namesOf(e).some((n) => words.some((w) => n.includes(w))));
}

// The alias list after typing one more: tidied, skipped when empty, already there or the exercise's own name.
export function addAlias(aliases: string[], text: string, name: string): string[] {
  const alias = tidy(text);
  const taken = [name, ...aliases].map(nameKey);
  return alias && !taken.includes(nameKey(alias)) ? [...aliases, alias] : aliases;
}
