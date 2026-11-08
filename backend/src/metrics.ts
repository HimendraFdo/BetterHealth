// The health metrics BetterHealth tracks. Adding one later means adding it
// here, to METRICS in google/health.ts, and to a migration.
export const METRIC_NAMES = ["steps", "calories"] as const;

// A union type built from the array above: "steps" | "calories".
export type Metric = (typeof METRIC_NAMES)[number];

export const METRIC_UNITS: Record<Metric, string> = {
  steps: "steps",
  calories: "kcal",
};

// One day's total for one metric. null means Google had no data that day,
// which is different from a real 0.
export interface DailyValue {
  date: string;
  value: number | null;
}
