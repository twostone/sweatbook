import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app.ts";
import { openDb, schemaVersion } from "./db.ts";
import { logger, resolveLogLevel, setLogLevel } from "./log.ts";
import { parseUrlSettings, readAddonOptions } from "./options.ts";
import { createHaTokenVerifier } from "./auth/ha-token.ts";
import { fetchHaExternalUrl } from "./auth/ha-url.ts";
import { installShutdownHandlers } from "./shutdown.ts";

// The app's options (Supervisor writes /data/options.json); `log_level` beats LOG_LEVEL, else info.
const log = logger("server");
const options = readAddonOptions(process.env.OPTIONS_PATH ?? "/data/options.json");
const { level: logLevel, invalid: invalidLevel } = resolveLogLevel(options, process.env.LOG_LEVEL);
setLogLevel(logLevel);
if (invalidLevel) log.warn("invalid_log_level", { value: invalidLevel, using: logLevel });
const version = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
})();

// In the HA app this is /data/sweatbook.db: /data is the app's persistent volume and part of HA backups.
const dbPath = process.env.DB_PATH ?? "./data/sweatbook.db";
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const mcpEnabled = options.mcp_enabled === true;

// OAuth for /mcp needs both public URLs: the app's own (only the user knows the reverse proxy) and Home Assistant's
// (from the option, else from HA's own settings). Missing either -> /mcp keeps working with the app's tokens only.
const urls = parseUrlSettings(options, process.env);
for (const name of urls.invalid) log.warn("invalid_url_option", { option: name });
const appUrl = urls.appExternalUrl;
const haUrl = mcpEnabled && appUrl ? (urls.haExternalUrl ?? (await fetchHaExternalUrl({ token: process.env.SUPERVISOR_TOKEN }))) : null;
if (mcpEnabled && appUrl && !haUrl) log.warn("oauth_off", { reason: "no external url of home assistant" });
const oauth = appUrl && haUrl ? { appUrl, haUrl, verifier: createHaTokenVerifier() } : undefined;

log.info("starting", { version, mcp: mcpEnabled, oauth: !!oauth, log_level: logLevel, schema: schemaVersion(db), tz: process.env.TZ, node: process.version });

const app = createApp(db, { allowedIp: process.env.INGRESS_ONLY_IP, mcpEnabled, appUrl: appUrl ?? undefined, oauth, version });
// API routes are registered first; anything else is the built frontend (npm run build).
app.use("/*", serveStatic({ root: "./dist" }));
const port = Number(process.env.PORT ?? 8099);
const server = serve({ fetch: app.fetch, port }, (i) => log.info("listening", { port: i.port }));

// SIGTERM from `docker stop` / the Supervisor: stop accepting requests, close the database, exit 0 (not "error").
installShutdownHandlers({ servers: [server], cleanup: () => db.close() });
