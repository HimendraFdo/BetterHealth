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

// Dates are "YYYY-MM-DD" strings with no time zone. Google calls these
// "civil" dates: they mean your local day, wherever you are.
function toCivilDateTime(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  // Numbers, not strings: the API rejects "02" style values.
  return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } };
}

// `date` shifted by `n` days (n can be negative). Done in UTC so time
// zones and daylight saving can't shift the result.
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const nextDay = (date: string) => addDays(date, 1);

interface DailyRollUpResponse {
  rollupDataPoints?: {
    civilStartTime: { date: { year: number; month: number; day: number } };
    // Missing entirely on days with no data at all.
    steps?: { countSum: string };
  }[];
}

export interface DailySteps {
  date: string;
  steps: number | null;
}

// Daily step totals from `start` to `end`, both inclusive, oldest first.
// Google limits this endpoint to 90 days per request.
export async function getDailySteps(
  accessToken: string,
  start: string,
  end: string,
  fetchFn: typeof fetch = fetch,
): Promise<DailySteps[]> {
  const data = await callApi<DailyRollUpResponse>(
    accessToken,
    "/users/me/dataTypes/steps/dataPoints:dailyRollUp",
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
        // countSum is a string because it's a 64-bit integer in Google's API.
        // null means "no data", which is different from walking 0 steps.
        steps: point.steps ? Number(point.steps.countSum) : null,
      };
    })
    // Google returns newest first; charts want oldest first.
    .sort((a, b) => a.date.localeCompare(b.date));
}
