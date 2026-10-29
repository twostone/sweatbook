import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import adapter from "@sveltejs/adapter-static";
import type { Adapter } from "@sveltejs/kit";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

const OUT_DIR = "dist"; // where the Hono server looks (src/server.ts)

// The app lives under an unknown, changing prefix (HA ingress: /api/hassio_ingress/<token>/), so every URL must be
// relative. The fallback page of adapter-static always has absolute asset paths (/_app/...), whatever paths.relative
// says, because it answers arbitrary paths. Here there is only one path (the hash router never changes it), so they
// are made relative after the adapter has written the page.
function relativeFallback(inner: Adapter): Adapter {
  return {
    ...inner,
    async adapt(builder) {
      await inner.adapt(builder);
      const file = join(OUT_DIR, "index.html");
      const page = readFileSync(file, "utf8").replaceAll(/(["'(])\/(_app\/|favicon\.svg|manifest\.webmanifest|apple-touch-icon\.png)/g, "$1./$2");
      writeFileSync(file, page);
    },
  };
}

// SvelteKit as a pure SPA (no server code): the result in dist/ is served by the Hono server.
// In development the proxy plays the ingress and passes a made-up Home Assistant user, otherwise every API call is 401.
export default defineConfig({
  plugins: [
    sveltekit({
      adapter: relativeFallback(adapter({ pages: OUT_DIR, assets: OUT_DIR, fallback: "index.html" })),
      files: { src: "web/src", assets: "web/static" },
      router: { type: "hash" },
      paths: { relative: true },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8099", headers: { "X-Remote-User-Id": "dev", "X-Remote-User-Display-Name": "Dev" } },
    },
  },
});
