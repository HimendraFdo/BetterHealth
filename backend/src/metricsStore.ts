import type { DailyValue, Metric } from "./metrics.js";

// What the sync has done for one metric, for the dashboard's status line.
export interface SyncState {
  // The newest day fetched, "YYYY-MM-DD".
  syncedThrough: string;
  // When that was saved, as an ISO 8601 timestamp.
  lastSyncedAt: string;
}

// Storage for synced daily totals, shaped like TokenStore: the routes and the
// sync job use this interface, tests use the memory version, and the server
// uses PostgresMetricsStore.
export interface MetricsStore {
  // Insert new days and overwrite days already stored.
  upsert(metric: Metric, days: DailyValue[]): Promise<void>;
  // Stored days from `start` to `end`, inclusive, oldest first.
  range(metric: Metric, start: string, end: string): Promise<DailyValue[]>;
  // The newest day the sync has fetched, or undefined if it never ran.
  getSyncedThrough(metric: Metric): Promise<string | undefined>;
  setSyncedThrough(metric: Metric, date: string): Promise<void>;
  // Both sync fields, or undefined if the sync never ran for this metric.
  getSyncState(metric: Metric): Promise<SyncState | undefined>;
}

export class MemoryMetricsStore implements MetricsStore {
  // Record<K, V> is like a Python dict type hint: dict[Metric, Map[...]].
  private days: Record<Metric, Map<string, number | null>> = {
    steps: new Map(),
    calories: new Map(),
  };
  private syncState = new Map<Metric, SyncState>();

  async upsert(metric: Metric, days: DailyValue[]) {
    for (const { date, value } of days) this.days[metric].set(date, value);
  }

  async range(metric: Metric, start: string, end: string) {
    return [...this.days[metric]]
      .filter(([date]) => date >= start && date <= end)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  }

  async getSyncedThrough(metric: Metric) {
    return this.syncState.get(metric)?.syncedThrough;
  }

  async setSyncedThrough(metric: Metric, date: string) {
    this.syncState.set(metric, { syncedThrough: date, lastSyncedAt: new Date().toISOString() });
  }

  async getSyncState(metric: Metric) {
    return this.syncState.get(metric);
  }
}
