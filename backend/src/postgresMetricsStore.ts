import type pg from "pg";
import type { DailyValue, Metric } from "./metrics.js";
import type { MetricsStore, SyncState } from "./metricsStore.js";

// Which table and column hold each metric. Table and column names can't be
// $1 parameters (only values can), so they're put into the SQL text. That's
// safe here because they come from this fixed list, never from a request.
const TABLES: Record<Metric, { table: string; column: string; sqlType: string }> = {
  steps: { table: "daily_steps", column: "steps", sqlType: "integer" },
  calories: { table: "daily_calories", column: "kcal", sqlType: "double precision" },
};

export class PostgresMetricsStore implements MetricsStore {
  constructor(private readonly pool: pg.Pool) {}

  async upsert(metric: Metric, days: DailyValue[]): Promise<void> {
    if (days.length === 0) return;
    const { table, column, sqlType } = TABLES[metric];
    // One statement for all the days: unnest() turns the two arrays into
    // rows, (date[0], value[0]), (date[1], value[1]), ... ON CONFLICT turns
    // the insert into an update for days we already have, e.g. today, which
    // keeps growing until midnight.
    await this.pool.query(
      `INSERT INTO ${table} (date, ${column})
       SELECT * FROM unnest($1::date[], $2::${sqlType}[])
       ON CONFLICT (date) DO UPDATE SET
         ${column} = EXCLUDED.${column},
         synced_at = now()`,
      [days.map((d) => d.date), days.map((d) => d.value)],
    );
  }

  async range(metric: Metric, start: string, end: string): Promise<DailyValue[]> {
    const { table, column } = TABLES[metric];
    const { rows } = await this.pool.query<DailyValue>(
      `SELECT date, ${column} AS value FROM ${table}
       WHERE date BETWEEN $1 AND $2
       ORDER BY date`,
      [start, end],
    );
    // date comes back as "YYYY-MM-DD" thanks to the type parser in db.ts.
    return rows;
  }

  async getSyncedThrough(metric: Metric): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ synced_through: string }>(
      "SELECT synced_through FROM sync_state WHERE metric = $1",
      [metric],
    );
    return rows[0]?.synced_through;
  }

  async getSyncState(metric: Metric): Promise<SyncState | undefined> {
    // pg turns timestamptz into a JS Date; the API sends ISO strings.
    const { rows } = await this.pool.query<{ synced_through: string; last_synced_at: Date }>(
      "SELECT synced_through, last_synced_at FROM sync_state WHERE metric = $1",
      [metric],
    );
    const row = rows[0];
    if (!row) return undefined;
    return { syncedThrough: row.synced_through, lastSyncedAt: row.last_synced_at.toISOString() };
  }

  async setSyncedThrough(metric: Metric, date: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sync_state (metric, synced_through, last_synced_at)
       VALUES ($1, $2, now())
       ON CONFLICT (metric) DO UPDATE SET
         synced_through = EXCLUDED.synced_through,
         last_synced_at = now()`,
      [metric, date],
    );
  }
}
