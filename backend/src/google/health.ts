import { nextDay } from "../dates.js";
import type { DailyValue, Metric } from "../metrics.js";

const API_BASE = "https://health.googleapis.com/v4";

// The API's error body looks like:
// {"error":{"code":400,"status":"FAILED_PRECONDITION","details":[{"reason":"ACCOUNT_NOT_LINKED"}]}}
interface GoogleErrorBody {
  error?: { code?: number; message?: string; details?: { reason?: string }[] };
}

export class HealthApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // e.g. "ACCOUNT_NOT_LINKED" when the account never signed in to the
    // Google Health app.
    readonly reason?: string,
  ) {
    super(message);
  }
}

async function callApi<T>(
  accessToken: string,
  path: string,
  fetchFn: typeof fetch,
  body?: unknown,
): Promise<T> {
  const res = await fetchFn(`${API_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as GoogleErrorBody;
    throw new HealthApiError(
      res.status,
      err.error?.message ?? `Google Health API returned ${res.status}`,
      err.error?.details?.find((d) => d.reason)?.reason,
    );
  }
  return (await res.json()) as T;
}

export interface Identity {
  healthUserId: string;
}

// Confirms the Google account is linked to Google Health.
export function getIdentity(accessToken: string, fetchFn: typeof fetch = fetch) {
  return callApi<Identity>(accessToken, "/users/me/identity", fetchFn);
}

// Google wants each date as an object of numbers, plus a time of day.
function toCivilDateTime(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  // Numbers, not strings: the API rejects "02" style values.
  return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } };
}

// One day in a dailyRollUp response. Only the field for the data type you
// asked for is present, and it's missing entirely on days with no data.
interface RollupPoint {
  civilStartTime: { date: { year: number; month: number; day: number } };
  // countSum is a string because it's a 64-bit integer in Google's API.
  steps?: { countSum: string };
  totalCalories?: { kcalSum: number };
}

interface DailyRollUpResponse {
  rollupDataPoints?: RollupPoint[];
}

// How one metric maps onto the Google Health API.
interface MetricSpec {
  // The data type name in the URL.
  dataType: string;
  // Most days Google allows in one dailyRollUp request.
  maxDays: number;
  // Pulls the day's total out of a point; null when there's no data.
  value(point: RollupPoint): number | null;
}

// `satisfies` makes TypeScript check that every metric is covered.
export const METRICS = {
  steps: {
    dataType: "steps",
    maxDays: 90,
    value: (p) => (p.steps ? Number(p.steps.countSum) : null),
  },
  calories: {
    // Total calories burned: resting (BMR) plus activity.
    dataType: "total-calories",
    maxDays: 14,
    value: (p) => p.totalCalories?.kcalSum ?? null,
  },
} satisfies Record<Metric, MetricSpec>;

// Daily totals for one metric from `start` to `end`, both inclusive, oldest
// first. The range must fit in METRICS[metric].maxDays; sync.ts splits
// longer ranges into chunks. Days Google has no record of are left out.
export async function getDailyRollup(
  accessToken: string,
  metric: Metric,
  start: string,
  end: string,
  fetchFn: typeof fetch = fetch,
): Promise<DailyValue[]> {
  const spec: MetricSpec = METRICS[metric];
  const data = await callApi<DailyRollUpResponse>(
    accessToken,
    `/users/me/dataTypes/${spec.dataType}/dataPoints:dailyRollUp`,
    fetchFn,
    {
      // Google's range is start-inclusive, end-exclusive, so ask for up to
      // midnight at the start of the day after `end`.
      range: { start: toCivilDateTime(start), end: toCivilDateTime(nextDay(end)) },
      windowSizeDays: 1,
    },
  );

  return (data.rollupDataPoints ?? [])
    .map((point) => {
      const { year, month, day } = point.civilStartTime.date;
      return {
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        value: spec.value(point),
      };
    })
    // Google returns newest first; we store and chart oldest first.
    .sort((a, b) => a.date.localeCompare(b.date));
}
