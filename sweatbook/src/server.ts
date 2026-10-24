import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app.ts";
import { openDb, schemaVersion } from "./db.ts";
import { logger, resolveLogLevel, setLogLevel } from "./log.ts";
import { readAddonOptions } from "./options.ts";

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
log.info("starting", { version, log_level: logLevel, schema: schemaVersion(db), tz: process.env.TZ, node: process.version });

const app = createApp(db, { allowedIp: process.env.INGRESS_ONLY_IP });
// API routes are registered first; anything else is the built frontend (npm run build).
app.use("/*", serveStatic({ root: "./dist" }));
const port = Number(process.env.PORT ?? 8099);
serve({ fetch: app.fetch, port }, (i) => log.info("listening", { port: i.port }));
