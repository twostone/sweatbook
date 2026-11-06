import { parsePublicUrl } from "../options.ts";
import { logger } from "../log.ts";

const log = logger("ha-url");

// The Supervisor proxies the Core REST API for apps with `homeassistant_api: true`. `GET /api/config` carries the
// external URL from Settings -> System -> Network. It is null when none is set there (e.g. only Home Assistant Cloud).
export const SUPERVISOR_CORE_CONFIG_URL = "http://supervisor/core/api/config";
const LOOKUP_TIMEOUT_MS = 5_000;

export type HaUrlLookup = { token?: string; url?: string; timeoutMs?: number; fetchFn?: typeof fetch };

// Public URL of Home Assistant, or null (no Supervisor token, HA unreachable, no external URL). Never throws: without it
// the app just runs without OAuth.
export async function fetchHaExternalUrl(opts: HaUrlLookup = {}): Promise<string | null> {
  if (!opts.token) return null;
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const res = await fetchFn(opts.url ?? SUPERVISOR_CORE_CONFIG_URL, {
      headers: { Authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn("ha_config_failed", { status: res.status });
      return null;
    }
    const body = (await res.json()) as { external_url?: unknown };
    return parsePublicUrl(body.external_url);
  } catch (err) {
    log.warn("ha_config_failed", { reason: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}
