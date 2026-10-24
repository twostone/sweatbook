// Parsing what is typed into the set fields. Each parser returns a number, null for an empty field, or undefined when
// the text is not valid (the field then shows an error and nothing is sent).

// Limits of the API (src/app.ts), checked here so a typo never reaches the server.
const MAX_KG = 1000;
const MAX_REPS = 1000;
const SECONDS_PER_MINUTE = 60;

// Time is typed as digits only, because the Android number pad has no colon: the last two digits are the seconds,
// "112" -> 1:12. Any other character (a colon typed on a desktop) is ignored.
export function parseDuration(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const digits = text.replace(/\D/g, "");
  if (!digits) return undefined;
  const seconds = Number(digits.slice(-2));
  const minutes = Number(digits.slice(0, -2) || "0");
  if (seconds >= SECONDS_PER_MINUTE) return undefined;
  return minutes * SECONDS_PER_MINUTE + seconds;
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// What the time field shows while typing: up to two digits as they are, from three on as m:ss.
export function durationInput(text: string): string {
  const digits = text.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length <= 2 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`;
}

// Empty = bodyweight. Comma or point as decimal separator.
export function parseKg(text: string): number | null | undefined {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const kg = Number(t);
  return kg <= MAX_KG ? kg : undefined;
}

export function parseReps(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  const reps = Number(t);
  return reps <= MAX_REPS ? reps : undefined;
}
