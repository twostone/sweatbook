// <input type="datetime-local"> works in local time without an offset ("2026-10-24T13:40"); the API stores UTC.

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// null for an empty or broken value.
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // without an offset, parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
