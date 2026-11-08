import Fastify from "fastify";

// Build the app separately from starting it, so tests can create an
// instance and send fake requests without opening a real network port.
export function buildApp({ logger = true } = {}) {
  const app = Fastify({ logger });

  // A health check: deploy tooling and uptime monitors hit this to ask
  // "is the server alive?" without touching the database or Google.
  app.get("/health", async () => {
    return { status: "ok" };
  });

  return app;
}
