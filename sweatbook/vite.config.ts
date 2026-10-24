import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// base "./": the app is served under an unknown, changing prefix by HA ingress
// (/api/hassio_ingress/<token>/), so every asset URL must be relative.
// In development the proxy plays the ingress and passes a made-up Home Assistant user, otherwise every API call is 401.
export default defineConfig({
  root: "web",
  base: "./",
  plugins: [svelte()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: "http://localhost:8099", headers: { "X-Remote-User-Id": "dev", "X-Remote-User-Display-Name": "Dev" } },
    },
  },
});
