import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { MemoryMetricsStore } from "./metricsStore.js";
import { MemoryTokenStore } from "./tokenStore.js";
import {
  CALORIES_URL,
  IDENTITY_URL,
  STEPS_URL,
  TOKEN_URL,
  fakeFetch,
  fakeRollup,
  google,
  json,
  validTokens,
} from "./testing.js";

const today = () => "2026-11-09";

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
  for (const [method, url] of [["GET", "/auth/google"], ["POST", "/api/sync"]] as const) {
    const res = await app.inject({ method, url });
    assert.equal(res.statusCode, 503, url);
  }
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

test("callback exchanges the code, checks identity, saves tokens, and starts a sync", async () => {
  const store = new MemoryTokenStore();
  const metricsStore = new MemoryMetricsStore();
  const { fn, calls } = fakeFetch({
    [TOKEN_URL]: () =>
      json({ access_token: "access-1", expires_in: 3599, refresh_token: "refresh-1", scope: "s" }),
    [IDENTITY_URL]: () => json({ name: "users/me/identity", healthUserId: "123" }),
    [STEPS_URL]: fakeRollup(() => ({ steps: { countSum: "100" } })),
    [CALORIES_URL]: fakeRollup(() => ({ totalCalories: { kcalSum: 2000 } })),
  });
  const app = buildApp({ logger: false, google, tokenStore: store, metricsStore, fetch: fn, today, syncBackfillDays: 3 });

  const state = await startLogin(app);
  const res = await app.inject({ method: "GET", url: `/auth/google/callback?code=the-code&state=${state}` });

  assert.equal(res.statusCode, 200);
  const body = new URLSearchParams(calls[0]!.init!.body as URLSearchParams);
  assert.equal(body.get("code"), "the-code");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal((await store.load())?.refreshToken, "refresh-1");

  // The sync runs in the background; POST /api/sync joins it if it's still
  // going, so once this returns the data is stored.
  await app.inject({ method: "POST", url: "/api/sync" });
  assert.equal((await metricsStore.range("steps", "2026-11-09", "2026-11-09")).length, 1);

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

test("GET /api/steps and /api/calories read stored days, oldest first", async () => {
  const metricsStore = new MemoryMetricsStore();
  await metricsStore.upsert("steps", [
    { date: "2026-11-03", value: 8012 },
    { date: "2026-11-01", value: 0 },
    { date: "2026-11-02", value: null },
    { date: "2026-10-31", value: 5000 }, // outside the range asked for
  ]);
  await metricsStore.upsert("calories", [{ date: "2026-11-02", value: 2450.5 }]);
  const app = buildApp({ logger: false, metricsStore, today });

  const steps = await app.inject({ method: "GET", url: "/api/steps?start=2026-11-01&end=2026-11-03" });
  assert.equal(steps.statusCode, 200);
  assert.deepEqual(steps.json(), {
    metric: "steps",
    unit: "steps",
    start: "2026-11-01",
    end: "2026-11-03",
    days: [
      { date: "2026-11-01", value: 0 },
      { date: "2026-11-02", value: null },
      { date: "2026-11-03", value: 8012 },
    ],
  });

  const calories = await app.inject({ method: "GET", url: "/api/calories?start=2026-11-01&end=2026-11-03" });
  assert.equal(calories.json().unit, "kcal");
  assert.deepEqual(calories.json().days, [{ date: "2026-11-02", value: 2450.5 }]);
});

test("GET /api/steps defaults to the last 7 days ending today", async () => {
  const app = buildApp({ logger: false, today });
  const res = await app.inject({ method: "GET", url: "/api/steps" });
  assert.equal(res.json().start, "2026-11-03");
  assert.equal(res.json().end, "2026-11-09");
});

test("GET /api/steps validates dates", async () => {
  const app = buildApp({ logger: false });
  for (const query of ["start=2026-02-30&end=2026-03-01", "start=nope&end=2026-03-01", "start=2026-03-02&end=2026-03-01", "start=2024-01-01&end=2026-12-31"]) {
    const res = await app.inject({ method: "GET", url: `/api/steps?${query}` });
    assert.equal(res.statusCode, 400, query);
  }
});

test("POST /api/sync needs a connection first", async () => {
  const app = buildApp({ logger: false, google });
  const res = await app.inject({ method: "POST", url: "/api/sync" });
  assert.equal(res.statusCode, 401);
});

test("POST /api/sync stores steps and calories and reports what it did", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.save(validTokens());
  const metricsStore = new MemoryMetricsStore();
  const { fn, calls } = fakeFetch({
    [STEPS_URL]: fakeRollup((date) => (date === "2026-11-08" ? { steps: { countSum: "8012" } } : {})),
    [CALORIES_URL]: fakeRollup(() => ({ totalCalories: { kcalSum: 2000.25 } })),
  });
  const app = buildApp({ logger: false, google, tokenStore, metricsStore, fetch: fn, today, syncBackfillDays: 3 });

  const res = await app.inject({ method: "POST", url: "/api/sync" });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.json().results.map((r: { metric: string; daysStored: number }) => [r.metric, r.daysStored]),
    [["steps", 3], ["calories", 3]],
  );
  assert.deepEqual(await metricsStore.range("steps", "2026-11-07", "2026-11-09"), [
    { date: "2026-11-07", value: null }, // a point with no steps field: no data
    { date: "2026-11-08", value: 8012 },
    { date: "2026-11-09", value: null },
  ]);
  assert.equal((await metricsStore.range("calories", "2026-11-09", "2026-11-09"))[0]?.value, 2000.25);
  assert.equal((calls[0]!.init!.headers as Record<string, string>).Authorization, "Bearer valid");
});

test("POST /api/sync refreshes an expired access token first", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.save({ refreshToken: "r", accessToken: "old", accessTokenExpiresAt: Date.now() - 1000, scope: "s" });
  const { fn, calls } = fakeFetch({
    [TOKEN_URL]: () => json({ access_token: "new", expires_in: 3599, scope: "s" }),
    [STEPS_URL]: () => json({ rollupDataPoints: [] }),
    [CALORIES_URL]: () => json({ rollupDataPoints: [] }),
  });
  const app = buildApp({ logger: false, google, tokenStore, fetch: fn, today, syncBackfillDays: 1 });

  const res = await app.inject({ method: "POST", url: "/api/sync" });

  assert.equal(res.statusCode, 200);
  assert.equal(calls[0]!.url, TOKEN_URL);
  assert.equal(calls.filter((c) => c.url === TOKEN_URL).length, 1); // refreshed once, then reused
  const saved = await tokenStore.load();
  assert.equal(saved?.accessToken, "new");
  assert.equal(saved?.refreshToken, "r"); // kept, since Google didn't send a new one
});

test("POST /api/sync asks to reconnect when the refresh token is dead", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.save({ refreshToken: "dead", accessToken: "old", accessTokenExpiresAt: 0, scope: "s" });
  const { fn } = fakeFetch({ [TOKEN_URL]: () => json({ error: "invalid_grant" }, 400) });
  const app = buildApp({ logger: false, google, tokenStore, fetch: fn, today });

  const res = await app.inject({ method: "POST", url: "/api/sync" });

  assert.equal(res.statusCode, 401);
  assert.match(res.json().error, /visit \/auth\/google/);
});

test("GET /api/status before connecting Google", async () => {
  const app = buildApp({ logger: false, google, today });
  const res = await app.inject({ method: "GET", url: "/api/status" });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    googleConfigured: true,
    connected: false,
    syncing: false,
    lastSync: null,
    today: "2026-11-09",
    metrics: [
      { metric: "steps", unit: "steps", syncedThrough: null, lastSyncedAt: null },
      { metric: "calories", unit: "kcal", syncedThrough: null, lastSyncedAt: null },
    ],
  });
});

test("GET /api/status reports a successful sync", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.save(validTokens());
  const { fn } = fakeFetch({
    [STEPS_URL]: fakeRollup(() => ({ steps: { countSum: "100" } })),
    [CALORIES_URL]: fakeRollup(() => ({ totalCalories: { kcalSum: 2000 } })),
  });
  const app = buildApp({ logger: false, google, tokenStore, fetch: fn, today, syncBackfillDays: 2 });
  await app.inject({ method: "POST", url: "/api/sync" });

  const body = (await app.inject({ method: "GET", url: "/api/status" })).json();

  assert.equal(body.connected, true);
  assert.equal(body.lastSync.ok, true);
  assert.equal(body.lastSync.error, undefined);
  for (const m of body.metrics) {
    assert.equal(m.syncedThrough, "2026-11-09", m.metric);
    assert.ok(!Number.isNaN(Date.parse(m.lastSyncedAt)), m.metric);
  }
});

test("GET /api/status reports an expired Google sign-in", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.save({ refreshToken: "dead", accessToken: "old", accessTokenExpiresAt: 0, scope: "s" });
  const { fn } = fakeFetch({ [TOKEN_URL]: () => json({ error: "invalid_grant" }, 400) });
  const app = buildApp({ logger: false, google, tokenStore, fetch: fn, today });
  await app.inject({ method: "POST", url: "/api/sync" });

  const body = (await app.inject({ method: "GET", url: "/api/status" })).json();

  assert.equal(body.connected, true); // tokens are stored, but they no longer work
  assert.equal(body.lastSync.ok, false);
  assert.equal(body.lastSync.error.code, "auth_expired");
});

test("callback redirects to the dashboard when appUrl is set", async () => {
  const { fn } = fakeFetch({
    [TOKEN_URL]: () => json({ access_token: "a", expires_in: 3599, refresh_token: "r", scope: "s" }),
    [IDENTITY_URL]: () => json({ name: "users/me/identity", healthUserId: "123" }),
    [STEPS_URL]: () => json({ rollupDataPoints: [] }),
    [CALORIES_URL]: () => json({ rollupDataPoints: [] }),
  });
  const app = buildApp({ logger: false, google, fetch: fn, today, syncBackfillDays: 1, appUrl: "http://127.0.0.1:5173" });

  const state = await startLogin(app);
  const res = await app.inject({ method: "GET", url: `/auth/google/callback?code=c&state=${state}` });

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, "http://127.0.0.1:5173");
});
