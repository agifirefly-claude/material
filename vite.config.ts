/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { include: ["tests/unit/**/*.test.ts"], exclude: [".claude/**", "node_modules/**"] },
  server: { port: 5173, host: "127.0.0.1" },
  // every page's dependencies found up front: otherwise one found later (after npm ci the cache is empty) makes
  // Vite re-optimize and reload the page, which kills a running harness, e2e or command line evaluation
  optimizeDeps: { entries: ["index.html", "cli.html", "tests/harness.html"] },
  build: { chunkSizeWarningLimit: 2000, rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), cli: resolve(import.meta.dirname, "cli.html") } } },
});
