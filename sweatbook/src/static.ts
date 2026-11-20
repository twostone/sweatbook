import { serveStatic } from "@hono/node-server/serve-static";
import type { MiddlewareHandler } from "hono";

// SvelteKit puts every bundled file under _app/immutable/ with a content hash in its name, so a changed file gets a new
// URL.
const HASHED_ASSETS_PREFIX = "/_app/immutable/";
const IMMUTABLE = "public, max-age=31536000, immutable";
// Everything else (index.html, _app/version.json, manifest, icons) must be revalidated on each load. Without an
// explicit header the browser guesses a lifetime from Last-Modified and keeps an old index.html after an update, which
// then asks for the previous version's file names and gets 404s: the app stays blank.
const REVALIDATE = "no-cache";

/** The built frontend in `root`, with cache headers that survive an update of the app. */
export function serveFrontend(root: string): MiddlewareHandler {
  const files = serveStatic({ root });
  return async (c, next) => {
    const res = await files(c, next);
    // serveStatic returns a Response only for a file it found. Its onFound hook runs after that Response is built,
    // so a header set there never arrives; set it on the Response instead.
    if (res instanceof Response) {
      res.headers.set("Cache-Control", c.req.path.startsWith(HASHED_ASSETS_PREFIX) ? IMMUTABLE : REVALIDATE);
    }
    return res;
  };
}
