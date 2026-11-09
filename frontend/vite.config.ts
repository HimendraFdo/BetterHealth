/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // The browser only ever talks to the Vite server; requests for /api and
    // /auth are passed on to Fastify. One origin means no CORS setup, the same
    // way Caddy will serve both in production.
    proxy: {
      "/api": backend,
      "/auth": backend,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
