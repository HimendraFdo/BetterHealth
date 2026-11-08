import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryMetricsStore } from "./metricsStore.js";
import { NotConnectedError, createSyncer, syncAll } from "./sync.js";
import { MemoryTokenStore } from "./tokenStore.js";
import {
  CALORIES_URL,
  STEPS_URL,
  fakeFetch,
  fakeRollup,
  google,
  json,
  requestedRange,
  validTokens,
} from "./testing.js";

async function setup(today = "2026-11-09") {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.save(validTokens());
  const metricsStore = new MemoryMetricsStore();
  const fake = fakeFetch({
    [STEPS_URL]: fakeRollup(() => ({ steps: { countSum: "1000" } })),
    [CALORIES_URL]: fakeRollup(() => ({ totalCalories: { kcalSum: 2000 } })),
  });
  const options = { google, tokenStore, metricsStore, fetch: fake.fn, today: () => today };
  // The date ranges sent to Google for one data type, in order.
  const rangesFor = (url: string) => fake.calls.filter((c) => c.url === url).map((c) => requestedRange(c.init));
  return { options, metricsStore, rangesFor, calls: fake.calls };
}

test("first sync backfills in chunks Google accepts: 90 days for steps, 14 for calories", async () => {
  const { options, metricsStore, rangesFor } = await setup();

  const results = await syncAll({ ...options, backfillDays: 30 });

  assert.deepEqual(rangesFor(STEPS_URL), [["2026-10-11", "2026-11-09"]]);
  assert.deepEqual(rangesFor(CALORIES_URL), [
    ["2026-10-11", "2026-10-24"],
    ["2026-10-25", "2026-11-07"],
    ["2026-11-08", "2026-11-09"],
  ]);
  assert.deepEqual(
    results.map((r) => [r.metric, r.start, r.end, r.daysStored, r.requests]),
    [
      ["steps", "2026-10-11", "2026-11-09", 30, 1],
      ["calories", "2026-10-11", "2026-11-09", 30, 3],
    ],
  );
  assert.equal(await metricsStore.getSyncedThrough("calories"), "2026-11-09");
});

test("later syncs fetch only the last few days again", async () => {
  const { options, rangesFor } = await setup("2026-11-12");
  await options.metricsStore.setSyncedThrough("steps", "2026-11-09");
  await options.metricsStore.setSyncedThrough("calories", "2026-11-12");

  await syncAll(options);

  // Steps: from 2 days before the last synced day up to today.
  assert.deepEqual(rangesFor(STEPS_URL), [["2026-11-07", "2026-11-12"]]);
  // Calories were synced today already: today and the 2 days before.
  assert.deepEqual(rangesFor(CALORIES_URL), [["2026-11-10", "2026-11-12"]]);
});

test("a metric with no data at all doesn't trigger the backfill again", async () => {
  const { options, rangesFor } = await setup();
  const empty = fakeFetch({
    [STEPS_URL]: () => json({}),
    [CALORIES_URL]: () => json({}),
  });
  await syncAll({ ...options, fetch: empty.fn, backfillDays: 30 });

  await syncAll(options);

  assert.deepEqual(rangesFor(CALORIES_URL), [["2026-11-07", "2026-11-09"]]);
});

test("a sync that fails halfway resumes from the last chunk it saved", async () => {
  const { options, metricsStore } = await setup();
  let calorieRequests = 0;
  const flaky = fakeFetch({
    [STEPS_URL]: fakeRollup(() => ({ steps: { countSum: "1" } })),
    [CALORIES_URL]: (init) => {
      calorieRequests++;
      if (calorieRequests === 2) return json({ error: { message: "boom" } }, 500);
      return fakeRollup(() => ({ totalCalories: { kcalSum: 1 } }))(init);
    },
  });

  await assert.rejects(syncAll({ ...options, fetch: flaky.fn, backfillDays: 30 }));

  assert.equal(await metricsStore.getSyncedThrough("calories"), "2026-10-24"); // first chunk kept
});

test("syncAll throws NotConnectedError without tokens", async () => {
  const { options } = await setup();
  await assert.rejects(
    syncAll({ ...options, tokenStore: new MemoryTokenStore() }),
    NotConnectedError,
  );
});

test("createSyncer shares a sync that is already running", async () => {
  const { options, calls } = await setup();
  const sync = createSyncer({ ...options, backfillDays: 1 });

  const [a, b] = await Promise.all([sync(), sync()]);

  assert.equal(a, b); // the same results object: one sync, two callers
  assert.equal(calls.length, 2); // one steps request + one calories request

  await sync(); // once finished, the next call starts a fresh sync
  assert.equal(calls.length, 4);
});
