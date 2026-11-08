import { buildApp } from "./app.js";

// Config comes from environment variables so the same code runs on your
// laptop, the VPS, and the NUC with different settings.
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const app = buildApp();

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
