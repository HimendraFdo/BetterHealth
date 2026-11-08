import { randomBytes } from "node:crypto";
import Fastify, { type FastifyReply } from "fastify";
import type { GoogleConfig } from "./config.js";
import { GoogleAuthError, buildAuthUrl, exchangeCode, getAccessToken } from "./google/oauth.js";
import { HealthApiError, addDays, getDailySteps, getIdentity } from "./google/health.js";
import { MemoryTokenStore, type TokenStore } from "./tokenStore.js";

export interface AppOptions {
  logger?: boolean;
  // Undefined when GOOGLE_* env vars aren't set; Google routes then say so.
  google?: GoogleConfig;
  tokenStore?: TokenStore;
  // Injected so tests can fake Google's responses without the network.
  fetch?: typeof fetch;
}

const STATE_TTL_MS = 10 * 60_000;
const MAX_STEP_DAYS = 90; // Google's limit for one dailyRollUp request
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Build the app separately from starting it, so tests can create an
// instance and send fake requests without opening a real network port.
export function buildApp({
  logger = true,
  google,
  tokenStore = new MemoryTokenStore(),
  fetch: fetchFn = fetch,
}: AppOptions = {}) {
  const app = Fastify({ logger });

  // OAuth "state" values we've handed out and not yet seen come back,
  // mapped to when they expire. Kept in memory: fine for one user and one
  // server process; a restart just means clicking "connect" again.
  const pendingStates = new Map<string, number>();

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
        return sendGoogleError(reply, err);
      }
      return { connected: true, next: "Try GET /api/steps" };
    },
  );

  // Daily step totals. Dates are inclusive "YYYY-MM-DD"; defaults to the
  // last 7 days ending today (in the server's time zone).
  app.get<{ Querystring: { start?: string; end?: string } }>(
    "/api/steps",
    async (request, reply) => {
      if (!google) return reply.code(503).send({ error: "Google OAuth is not configured" });

      const end = request.query.end ?? localDate(new Date());
      const start = request.query.start ?? addDays(end, -6);
      if (!isValidDate(start) || !isValidDate(end)) {
        return reply.code(400).send({ error: "start and end must be YYYY-MM-DD" });
      }
      const days = daysBetween(start, end) + 1;
      if (days < 1 || days > MAX_STEP_DAYS) {
        return reply.code(400).send({ error: `Range must be 1 to ${MAX_STEP_DAYS} days` });
      }

      try {
        const accessToken = await getAccessToken(google, tokenStore, fetchFn);
        if (!accessToken) {
          return reply.code(401).send({ error: "Not connected; visit /auth/google first" });
        }
        return { start, end, days: await getDailySteps(accessToken, start, end, fetchFn) };
      } catch (err) {
        return sendGoogleError(reply, err);
      }
    },
  );

  // Turn errors from Google into responses that say what to do next.
  function sendGoogleError(reply: FastifyReply, err: unknown) {
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

// "YYYY-MM-DD" for a moment in the server's local time zone.
function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Real calendar date? Rejects "2026-02-30", which Date would roll into March.
function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(date);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}
