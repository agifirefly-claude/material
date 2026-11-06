/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { include: ["tests/unit/**/*.test.ts"], exclude: [".claude/**", "node_modules/**"] },
  server: { port: 5173, host: "127.0.0.1" },
  build: { chunkSizeWarningLimit: 2000, rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html") } } },
});
