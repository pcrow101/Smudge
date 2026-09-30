import { defineConfig } from "vite";

/**
 * Dev-server-only config for the interactive benchmark page. Never builds —
 * `npm run bench` just opens `bench.html` via `vite dev` so `bench/main.ts`
 * can boot the real editor (`../src/index`) and report live timings in a
 * real browser. Nothing here is copied into the shipped app bundle.
 */
export default defineConfig({
  root: "bench",
  server: { open: "/bench.html" }
});
