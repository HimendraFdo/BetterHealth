import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { MemoryTokenStore } from "./tokenStore.js";

const google = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://127.0.0.1:3000/auth/google/callback",
};

// A stand-in for fetch: answers by URL and records what was requested,
// so tests never touch the real Google servers.
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!match) throw new Error(`Unexpected fetch: ${url}`);
    return routes[match]!();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const IDENTITY_URL = "https://health.googleapis.com/v4/users/me/identity";
const STEPS_URL = "https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp";

// Runs /auth/google and returns the state it put in Google's URL.
async function startLogin(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({ method: "GET", url: "/auth/google" });
  assert.equal(res.statusCode, 302);
  return new URL(res.headers.location as string).searchParams.get("state")!;
}

test("GET /health returns ok", async () => {
  const app = buildApp({ logger: false });

  // inject() simulates an HTTP request in memory; no port is opened.
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});

test("Google routes return 503 when OAuth isn't configured", async () => {
  const app = buildApp({ logger: false });
  const res = await app.inject({ method: "GET", url: "/auth/google" });
  assert.equal(res.statusCode, 503);
});

test("GET /auth/google redirects to Google's consent screen", async () => {
  const app = buildApp({ logger: false, google });
  const res = await app.inject({ method: "GET", url: "/auth/google" });

  assert.equal(res.statusCode, 302);
  const url = new URL(res.headers.location as string);
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), google.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), google.redirectUri);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.match(url.searchParams.get("scope")!, /googlehealth\.activity_and_fitness\.readonly/);
  assert.ok(url.searchParams.get("state")!.length >= 32);
});

test("callback rejects an unknown state", async () => {
  const app = buildApp({ logger: false, google });
  const res = await app.inject({ method: "GET", url: "/auth/google/callback?code=abc&state=forged" });
  assert.equal(res.statusCode, 400);
});

test("callback exchanges the code, checks identity, and saves tokens", async () => {
  const store = new MemoryTokenStore();
  const { fn, calls } = fakeFetch({
    [TOKEN_URL]: () =>
      json({ access_token: "access-1", expires_in: 3599, refresh_token: "refresh-1", scope: "s" }),
    [IDENTITY_URL]: () => json({ name: "users/me/identity", healthUserId: "123" }),
  });
  const app = buildApp({ logger: false, google, tokenStore: store, fetch: fn });

  const state = await startLogin(app);
  const res = await app.inject({ method: "GET", url: `/auth/google/callback?code=the-code&state=${state}` });

  assert.equal(res.statusCode, 200);
  const body = new URLSearchParams(calls[0]!.init!.body as URLSearchParams);
  assert.equal(body.get("code"), "the-code");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal((await store.load())?.refreshToken, "refresh-1");

  // A state works only once.
  const again = await app.inject({ method: "GET", url: `/auth/google/callback?code=x&state=${state}` });
  assert.equal(again.statusCode, 400);
});

test("callback reports an account not linked to Google Health", async () => {
  const store = new MemoryTokenStore();
  const { fn } = fakeFetch({
    [TOKEN_URL]: () =>
      json({ access_token: "a", expires_in: 3599, refresh_token: "r", scope: "s" }),
    [IDENTITY_URL]: () =>
      json(
        { error: { code: 400, message: "not linked", details: [{ reason: "ACCOUNT_NOT_LINKED" }] } },
        400,
      ),
  });
  const app = buildApp({ logger: false, google, tokenStore: store, fetch: fn });

  const state = await startLogin(app);
  const res = await app.inject({ method: "GET", url: `/auth/google/callback?code=c&state=${state}` });

  assert.equal(res.statusCode, 409);
  assert.equal(await store.load(), undefined); // not marked as connected
});

test("GET /api/steps needs a connection first", async () => {
  const app = buildApp({ logger: false, google });
  const res = await app.inject({ method: "GET", url: "/api/steps?start=2026-11-01&end=2026-11-07" });
  assert.equal(res.statusCode, 401);
});

test("GET /api/steps validates dates", async () => {
  const app = buildApp({ logger: false, google });
  for (const query of ["start=2026-02-30&end=2026-03-01", "start=nope&end=2026-03-01", "start=2026-03-02&end=2026-03-01", "start=2026-01-01&end=2026-12-31"]) {
    const res = await app.inject({ method: "GET", url: `/api/steps?${query}` });
    assert.equal(res.statusCode, 400, query);
  }
});

test("GET /api/steps returns daily totals oldest first", async () => {
  const store = new MemoryTokenStore();
  await store.save({ refreshToken: "r", accessToken: "valid", accessTokenExpiresAt: Date.now() + 3_600_000, scope: "s" });
  const { fn, calls } = fakeFetch({
    [STEPS_URL]: () =>
      json({
        rollupDataPoints: [
          { civilStartTime: { date: { year: 2026, month: 11, day: 3 } }, steps: { countSum: "8012" } },
          { civilStartTime: { date: { year: 2026, month: 11, day: 2 } } },
          { civilStartTime: { date: { year: 2026, month: 11, day: 1 } }, steps: { countSum: "0" } },
        ],
      }),
  });
  const app = buildApp({ logger: false, google, tokenStore: store, fetch: fn });

  const res = await app.inject({ method: "GET", url: "/api/steps?start=2026-11-01&end=2026-11-03" });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().days, [
    { date: "2026-11-01", steps: 0 },
    { date: "2026-11-02", steps: null },
    { date: "2026-11-03", steps: 8012 },
  ]);
  // End is exclusive on Google's side, so we ask up to the next midnight.
  const sent = JSON.parse(calls[0]!.init!.body as string);
  assert.deepEqual(sent.range.end.date, { year: 2026, month: 11, day: 4 });
  assert.equal((calls[0]!.init!.headers as Record<string, string>).Authorization, "Bearer valid");
});

test("GET /api/steps refreshes an expired access token first", async () => {
  const store = new MemoryTokenStore();
  await store.save({ refreshToken: "r", accessToken: "old", accessTokenExpiresAt: Date.now() - 1000, scope: "s" });
  const { fn, calls } = fakeFetch({
    [TOKEN_URL]: () => json({ access_token: "new", expires_in: 3599, scope: "s" }),
    [STEPS_URL]: () => json({ rollupDataPoints: [] }),
  });
  const app = buildApp({ logger: false, google, tokenStore: store, fetch: fn });

  const res = await app.inject({ method: "GET", url: "/api/steps?start=2026-11-01&end=2026-11-01" });

  assert.equal(res.statusCode, 200);
  assert.equal(calls[0]!.url, TOKEN_URL);
  const saved = await store.load();
  assert.equal(saved?.accessToken, "new");
  assert.equal(saved?.refreshToken, "r"); // kept, since Google didn't send a new one
});

test("GET /api/steps asks to reconnect when the refresh token is dead", async () => {
  const store = new MemoryTokenStore();
  await store.save({ refreshToken: "dead", accessToken: "old", accessTokenExpiresAt: 0, scope: "s" });
  const { fn } = fakeFetch({ [TOKEN_URL]: () => json({ error: "invalid_grant" }, 400) });
  const app = buildApp({ logger: false, google, tokenStore: store, fetch: fn });

  const res = await app.inject({ method: "GET", url: "/api/steps?start=2026-11-01&end=2026-11-01" });

  assert.equal(res.statusCode, 401);
});
