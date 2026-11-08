import type { DailyValue, Metric } from "./metrics.js";

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
}

export class MemoryMetricsStore implements MetricsStore {
  // Record<K, V> is like a Python dict type hint: dict[Metric, Map[...]].
  private days: Record<Metric, Map<string, number | null>> = {
    steps: new Map(),
    calories: new Map(),
  };
  private syncedThrough = new Map<Metric, string>();

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
    return this.syncedThrough.get(metric);
  }

  async setSyncedThrough(metric: Metric, date: string) {
    this.syncedThrough.set(metric, date);
  }
}
