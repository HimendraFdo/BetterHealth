import { buildApp } from "./app.js";
import { loadGoogleConfig } from "./config.js";
import { createPool } from "./db.js";
import { PostgresMetricsStore } from "./postgresMetricsStore.js";
import { PostgresTokenStore } from "./postgresTokenStore.js";

// Config comes from environment variables so the same code runs on your
// laptop, the VPS, and the NUC with different settings.
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const syncIntervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 60);
const syncBackfillDays = Number(process.env.SYNC_BACKFILL_DAYS ?? 365);

const google = loadGoogleConfig();
const pool = createPool();
const app = buildApp({
  google,
  tokenStore: new PostgresTokenStore(pool),
  metricsStore: new PostgresMetricsStore(pool),
  syncIntervalMinutes,
  syncBackfillDays,
  appUrl: process.env.APP_URL,
});

// When the server shuts down, close the database connections too.
app.addHook("onClose", async () => {
  await pool.end();
});

if (!google) {
  app.log.warn("GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI not set; Google routes are disabled");
}

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
