import { readFileSync } from "node:fs";

// The app's options as the Supervisor writes them to /data/options.json. Read once at start: a change needs a restart.
// No file (development, tests) or broken JSON -> {}, so every option falls back to its default.
export type AddonOptions = Record<string, unknown>;
export function readAddonOptions(path: string): AddonOptions {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as AddonOptions) : {};
  } catch {
    return {}; // no options file outside the add-on
  }
}
