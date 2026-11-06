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

// A public base URL: http(s) only, no credentials, query or fragment. A trailing slash must not matter.
export function parsePublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export type UrlSettings = {
  /** Public URL of this app (behind the reverse proxy), no trailing slash. */
  appExternalUrl: string | null;
  /** Public URL of Home Assistant as set in the options; null = ask Home Assistant itself (see auth/ha-url.ts). */
  haExternalUrl: string | null;
  /** Names of options that were set but unusable; the caller logs them. */
  invalid: string[];
};

// Environment variables beat the options file (development, Docker smoke test).
export function parseUrlSettings(options: AddonOptions, env: Record<string, string | undefined> = {}): UrlSettings {
  const invalid: string[] = [];
  const url = (name: string, option: unknown, envValue: string | undefined): string | null => {
    const raw = envValue || option;
    if (raw === undefined || raw === null || raw === "") return null;
    const parsed = parsePublicUrl(raw);
    if (!parsed) invalid.push(name);
    return parsed;
  };
  return {
    appExternalUrl: url("app_external_url", options.app_external_url, env.APP_EXTERNAL_URL),
    haExternalUrl: url("ha_external_url", options.ha_external_url, env.HA_EXTERNAL_URL),
    invalid,
  };
}
