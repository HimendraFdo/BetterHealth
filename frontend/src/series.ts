import type { DailyValue } from "./api";
import { datesBetween } from "./dates";

// One bar on the chart. `status` keeps the three cases apart:
// a recorded number, a day Google reported as empty (null), and a date the
// database has no row for at all. Only "recorded" days count in averages.
export interface SeriesDay {
  date: string;
  value: number | null;
  status: "recorded" | "no-data" | "missing";
}

// The API only returns stored days, so a 30-day request can come back with
// 12 entries. Filling in every date makes the gaps visible on the chart
// instead of the bars silently squeezing together.
export function fillRange(days: DailyValue[], start: string, end: string): SeriesDay[] {
  const byDate = new Map(days.map((d) => [d.date, d.value]));
  return datesBetween(start, end).map((date) => {
    if (!byDate.has(date)) return { date, value: null, status: "missing" };
    const value = byDate.get(date) ?? null;
    return { date, value, status: value === null ? "no-data" : "recorded" };
  });
}

export interface Summary {
  today: number | null;
  average: number | null;
  best: { date: string; value: number } | null;
  recordedDays: number;
  totalDays: number;
}

export function summarize(series: SeriesDay[], today: string): Summary {
  const recorded = series.filter((d): d is SeriesDay & { value: number } => d.status === "recorded");
  const total = recorded.reduce((sum, d) => sum + d.value, 0);
  let best: Summary["best"] = null;
  for (const d of recorded) if (!best || d.value > best.value) best = { date: d.date, value: d.value };
  return {
    today: series.find((d) => d.date === today)?.value ?? null,
    average: recorded.length ? total / recorded.length : null,
    best,
    recordedDays: recorded.length,
    totalDays: series.length,
  };
}

const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

// The database keeps kcal fractions (3274.69); people read whole numbers.
export const formatNumber = (n: number) => whole.format(Math.round(n));
export const formatCompact = (n: number) => compact.format(n);

// Round y-axis steps (1, 2, 2.5 or 5 times a power of ten), about four of
// them, so the gridlines read 0 / 5K / 10K / 15K rather than 3.5K / 7K.
export function valueTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough)!;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(t);
  return ticks;
}
