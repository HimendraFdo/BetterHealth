import { randomBytes } from "node:crypto";
import Fastify, { type FastifyReply } from "fastify";
import type { GoogleConfig } from "./config.js";
import { addDays, daysBetween, isValidDate, localDate } from "./dates.js";
import { GoogleAuthError, buildAuthUrl, exchangeCode } from "./google/oauth.js";
import { HealthApiError, getIdentity } from "./google/health.js";
import { METRIC_NAMES, METRIC_UNITS } from "./metrics.js";
import { MemoryMetricsStore, type MetricsStore } from "./metricsStore.js";
import { NotConnectedError, createSyncer } from "./sync.js";
import { MemoryTokenStore, type TokenStore } from "./tokenStore.js";

export interface AppOptions {
  logger?: boolean;
  // Undefined when GOOGLE_* env vars aren't set; Google routes then say so.
  google?: GoogleConfig;
  tokenStore?: TokenStore;
  metricsStore?: MetricsStore;
  // Injected so tests can fake Google's responses without the network.
  fetch?: typeof fetch;
  // Sync in the background every N minutes. Omitted or 0: no timer
  // (tests leave it out; POST /api/sync still works).
  syncIntervalMinutes?: number;
  // How many days of history the first sync downloads.
  syncBackfillDays?: number;
  // Injected by tests so "today" doesn't depend on the real clock.
  today?: () => string;
  // Where to send the browser after connecting Google, e.g. the dashboard
  // at http://127.0.0.1:5173. Omitted: the callback answers with JSON.
  appUrl?: string;
}

// Why the last sync failed, in a form the dashboard can act on:
// "auth_expired" and "not_connected" mean "show the Reconnect button".
export type SyncErrorCode = "not_connected" | "auth_expired" | "account_not_linked" | "api_error" | "unknown";

export interface LastSync {
  at: string;
  ok: boolean;
  error?: { code: SyncErrorCode; message: string };
}

const STATE_TTL_MS = 10 * 60_000;
// Reading from our own database has no Google limit; this just stops one
// request from asking for decades of rows.
const MAX_RANGE_DAYS = 366;

// Build the app separately from starting it, so tests can create an
// instance and send fake requests without opening a real network port.
export function buildApp({
  logger = true,
  google,
  tokenStore = new MemoryTokenStore(),
  metricsStore = new MemoryMetricsStore(),
  fetch: fetchFn = fetch,
  syncIntervalMinutes = 0,
  syncBackfillDays,
  today = () => localDate(new Date()),
  appUrl,
}: AppOptions = {}) {
  const app = Fastify({ logger });

  // OAuth "state" values we've handed out and not yet seen come back,
  // mapped to when they expire. Kept in memory: fine for one user and one
  // server process; a restart just means clicking "connect" again.
  const pendingStates = new Map<string, number>();

  // Undefined without Google settings: there's nothing to sync from.
  const syncOnce = google
    ? createSyncer({ google, tokenStore, metricsStore, fetch: fetchFn, backfillDays: syncBackfillDays, today })
    : undefined;

  // The outcome of the most recent sync (scheduled or "sync now"), kept in
  // memory for GET /api/status. Undefined until the first sync finishes
  // after the server starts.
  let lastSync: LastSync | undefined;
  let syncing = false;

  // Every sync goes through here so its outcome is recorded.
  const sync = syncOnce
    ? async () => {
        syncing = true;
        try {
          const results = await syncOnce();
          lastSync = { at: new Date().toISOString(), ok: true };
          return results;
        } catch (err) {
          lastSync = { at: new Date().toISOString(), ok: false, error: describeSyncError(err) };
          throw err;
        } finally {
          syncing = false;
        }
      }
    : undefined;

  // A health check: deploy tooling and uptime monitors hit this to ask
  // "is the server alive?" without touching the database or Google.
  app.get("/health", async () => {
    return { status: "ok" };
  });

  // Step 1 of OAuth: send the browser to Google's consent screen.
  app.get("/auth/google", async (_request, reply) => {
    if (!google) return reply.code(503).send({ error: "Google OAuth is not configured" });

    const now = Date.now();
    for (const [s, expires] of pendingStates) if (expires < now) pendingStates.delete(s);

    const state = randomBytes(32).toString("base64url");
    pendingStates.set(state, now + STATE_TTL_MS);
    return reply.redirect(buildAuthUrl(google, state));
  });

  // Step 2 of OAuth: Google sends the browser back here with a one-time code.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/google/callback",
    async (request, reply) => {
      if (!google) return reply.code(503).send({ error: "Google OAuth is not configured" });

      const { code, state, error } = request.query;
      // e.g. "access_denied" if you clicked Cancel on the consent screen.
      if (error) return reply.code(400).send({ error: `Google returned: ${error}` });

      const expires = state ? pendingStates.get(state) : undefined;
      if (!state || !expires || expires < Date.now()) {
        return reply.code(400).send({ error: "Invalid or expired state; start again at /auth/google" });
      }
      pendingStates.delete(state); // each state works once
      if (!code) return reply.code(400).send({ error: "Missing code" });

      try {
        const tokens = await exchangeCode(google, code, fetchFn);
        // Google's advice: check the account is linked to Google Health
        // before treating it as connected.
        await getIdentity(tokens.accessToken, fetchFn);
        await tokenStore.save(tokens);
      } catch (err) {
        return sendSyncError(reply, err);
      }
      // Start filling the database right away instead of waiting for the
      // timer. Not awaited: the browser gets its answer immediately.
      if (sync) void sync().catch((err) => logSyncError(err));
      if (appUrl) return reply.redirect(appUrl);
      return { connected: true, next: "Syncing now; try GET /api/steps in a moment" };
    },
  );

  // GET /api/steps and GET /api/calories: daily totals from our database
  // (filled by the sync), not from Google. Dates are inclusive
  // "YYYY-MM-DD"; defaults to the last 7 days ending today.
  for (const metric of METRIC_NAMES) {
    app.get<{ Querystring: { start?: string; end?: string } }>(
      `/api/${metric}`,
      async (request, reply) => {
        const end = request.query.end ?? today();
        const start = request.query.start ?? addDays(end, -6);
        if (!isValidDate(start) || !isValidDate(end)) {
          return reply.code(400).send({ error: "start and end must be YYYY-MM-DD" });
        }
        const days = daysBetween(start, end) + 1;
        if (days < 1 || days > MAX_RANGE_DAYS) {
          return reply.code(400).send({ error: `Range must be 1 to ${MAX_RANGE_DAYS} days` });
        }
        return {
          metric,
          unit: METRIC_UNITS[metric],
          start,
          end,
          // Only days the sync has stored; a missing date means no data.
          days: await metricsStore.range(metric, start, end),
        };
      },
    );
  }

  // What the dashboard needs to draw its header: is Google connected, how
  // fresh is the data, and did the last sync fail (e.g. expired sign-in)?
  app.get("/api/status", async () => {
    const tokens = await tokenStore.load();
    const metrics = await Promise.all(
      METRIC_NAMES.map(async (metric) => {
        const state = await metricsStore.getSyncState(metric);
        return {
          metric,
          unit: METRIC_UNITS[metric],
          syncedThrough: state?.syncedThrough ?? null,
          lastSyncedAt: state?.lastSyncedAt ?? null,
        };
      }),
    );
    return {
      googleConfigured: google !== undefined,
      connected: tokens !== undefined,
      syncing,
      lastSync: lastSync ?? null,
      // The server's "today", so the dashboard's date ranges match the
      // server's time zone rather than the browser's.
      today: today(),
      metrics,
    };
  });

  // Run a sync now and report what it fetched.
  app.post("/api/sync", async (_request, reply) => {
    if (!sync) return reply.code(503).send({ error: "Google OAuth is not configured" });
    try {
      return { results: await sync() };
    } catch (err) {
      return sendSyncError(reply, err);
    }
  });

  // The scheduled sync: once when the server starts, then every N minutes.
  if (sync && syncIntervalMinutes > 0) {
    let timer: NodeJS.Timeout | undefined;
    const runScheduledSync = async () => {
      try {
        app.log.info({ results: await sync() }, "Scheduled sync finished");
      } catch (err) {
        logSyncError(err);
      }
    };
    // onReady runs once the server is set up, just before it starts listening.
    app.addHook("onReady", async () => {
      void runScheduledSync();
      timer = setInterval(runScheduledSync, syncIntervalMinutes * 60_000);
    });
    app.addHook("onClose", async () => clearInterval(timer));
  }

  // A sync that fails in the background has no browser to answer, so the
  // log is the only place to say what went wrong and what to do.
  function logSyncError(err: unknown) {
    if (err instanceof NotConnectedError) {
      app.log.info("Sync skipped: not connected to Google yet; visit /auth/google");
    } else if (err instanceof GoogleAuthError) {
      app.log.warn(`Sync failed: Google sign-in expired; visit /auth/google. ${err.message}`);
    } else {
      app.log.error({ err }, "Sync failed");
    }
  }

  function describeSyncError(err: unknown): NonNullable<LastSync["error"]> {
    if (err instanceof NotConnectedError) return { code: "not_connected", message: err.message };
    if (err instanceof GoogleAuthError) {
      return { code: "auth_expired", message: "Google sign-in failed or expired; reconnect Google" };
    }
    if (err instanceof HealthApiError) {
      if (err.reason === "ACCOUNT_NOT_LINKED") {
        return { code: "account_not_linked", message: "This Google account isn't linked to Google Health" };
      }
      return { code: "api_error", message: `Google Health API error: ${err.message}` };
    }
    return { code: "unknown", message: err instanceof Error ? err.message : String(err) };
  }

  // Turn errors from Google into responses that say what to do next.
  function sendSyncError(reply: FastifyReply, err: unknown) {
    if (err instanceof NotConnectedError) {
      return reply.code(401).send({ error: err.message });
    }
    if (err instanceof GoogleAuthError) {
      app.log.warn(err.message);
      // Usually an expired or revoked refresh token: reconnect.
      return reply.code(401).send({ error: "Google sign-in failed or expired; visit /auth/google" });
    }
    if (err instanceof HealthApiError) {
      app.log.warn({ status: err.status, reason: err.reason }, err.message);
      if (err.reason === "ACCOUNT_NOT_LINKED") {
        return reply.code(409).send({
          error: "This Google account isn't linked to Google Health. Sign in to the Google Health app, then reconnect.",
        });
      }
      return reply.code(502).send({ error: `Google Health API error: ${err.message}` });
    }
    throw err; // unexpected: let Fastify log it and return 500
  }

  return app;
}
