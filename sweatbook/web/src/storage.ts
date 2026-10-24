// Small JSON store in localStorage for what must survive a dead spot or a reload: unsent set rows and the last loaded
// session. Every access is guarded: private mode, a full or blocked storage must never break the app.

const PREFIX = "sweatbook:";

export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage unavailable: the input then only lives on screen
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // see save
  }
}
