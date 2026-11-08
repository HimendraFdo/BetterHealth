import type { GoogleConfig } from "./config.js";
import { addDays, localDate, minDate } from "./dates.js";
import { METRICS, getDailyRollup } from "./google/health.js";
import { getAccessToken } from "./google/oauth.js";
import { METRIC_NAMES, type Metric } from "./metrics.js";
import type { MetricsStore } from "./metricsStore.js";
import type { TokenStore } from "./tokenStore.js";

// Every sync fetches the last few days again, even if they were synced
// before: today is still in progress, and the watch can upload yesterday's
// data hours late. Upserts make fetching a day twice harmless.
export const REFETCH_DAYS = 3;

export interface SyncOptions {
  google: GoogleConfig;
  tokenStore: TokenStore;
  metricsStore: MetricsStore;
  fetch?: typeof fetch;
  // How many days of history the very first sync downloads.
  backfillDays?: number;
  // Injected by tests; defaults to the real clock in the server's time zone.
  today?: () => string;
}

export interface SyncResult {
  metric: Metric;
  start: string;
  end: string;
  // Days Google returned (it leaves out days it has no record of).
  daysStored: number;
  requests: number;
}

// Thrown when there are no tokens yet, i.e. nobody has visited /auth/google.
export class NotConnectedError extends Error {
  constructor() {
    super("Not connected to Google; visit /auth/google first");
  }
}

// Fetches every metric from Google and stores it. Errors from Google (an
// expired refresh token, an API failure) are thrown to the caller.
export async function syncAll({
  google,
  tokenStore,
  metricsStore,
  fetch: fetchFn = fetch,
  backfillDays = 365,
  today: getToday = () => localDate(new Date()),
}: SyncOptions): Promise<SyncResult[]> {
  const today = getToday();
  const results: SyncResult[] = [];

  for (const metric of METRIC_NAMES) {
    const syncedThrough = await metricsStore.getSyncedThrough(metric);
    // First run: the whole backfill window. Later runs: from a few days
    // before the last synced day, so recent days get refreshed.
    const start = syncedThrough
      ? addDays(minDate(syncedThrough, today), -(REFETCH_DAYS - 1))
      : addDays(today, -(backfillDays - 1));

    const { maxDays } = METRICS[metric];
    let daysStored = 0;
    let requests = 0;

    // Walk from `start` to today in chunks Google accepts, oldest first.
    for (let chunkStart = start; chunkStart <= today; chunkStart = addDays(chunkStart, maxDays)) {
      const chunkEnd = minDate(addDays(chunkStart, maxDays - 1), today);
      // Asked for per chunk: it's free while the access token is still valid,
      // and refreshes it if a long backfill outlasts it.
      const accessToken = await getAccessToken(google, tokenStore, fetchFn);
      if (!accessToken) throw new NotConnectedError();

      const days = await getDailyRollup(accessToken, metric, chunkStart, chunkEnd, fetchFn);
      await metricsStore.upsert(metric, days);
      // Saved after every chunk, so a sync that fails halfway resumes from
      // here next time instead of starting the backfill again.
      await metricsStore.setSyncedThrough(metric, chunkEnd);
      daysStored += days.length;
      requests++;
    }
    results.push({ metric, start, end: today, daysStored, requests });
  }
  return results;
}

// Wraps syncAll so only one sync runs at a time. If a sync is already in
// progress (say the hourly timer fires while you clicked "sync now"), callers
// share the running one instead of starting a second.
export function createSyncer(options: SyncOptions): () => Promise<SyncResult[]> {
  let running: Promise<SyncResult[]> | undefined;
  return () => {
    // ??= assigns only if `running` is undefined, like Python's
    // `if running is None: running = ...`.
    running ??= syncAll(options).finally(() => {
      running = undefined;
    });
    return running;
  };
}
