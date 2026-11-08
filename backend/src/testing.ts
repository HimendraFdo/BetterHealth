// Helpers shared by the *.test.ts files. Excluded from the build in
// tsconfig.json, like the tests themselves.
import { addDays } from "./dates.js";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const IDENTITY_URL = "https://health.googleapis.com/v4/users/me/identity";
export const STEPS_URL = "https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp";
export const CALORIES_URL =
  "https://health.googleapis.com/v4/users/me/dataTypes/total-calories/dataPoints:dailyRollUp";

export const google = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://127.0.0.1:3000/auth/google/callback",
};

// Tokens that won't need refreshing during a test.
export const validTokens = () => ({
  refreshToken: "r",
  accessToken: "valid",
  accessTokenExpiresAt: Date.now() + 3_600_000,
  scope: "s",
});

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// A stand-in for fetch: answers by URL prefix and records what was requested,
// so tests never touch the real Google servers.
export function fakeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!match) throw new Error(`Unexpected fetch: ${url}`);
    return routes[match]!(init);
  }) as typeof fetch;
  return { fn, calls };
}

type CivilDate = { year: number; month: number; day: number };
const fromCivil = ({ year, month, day }: CivilDate) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const toCivil = (date: string): CivilDate => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month, day };
};

// Fakes a dailyRollUp endpoint: reads the range from the request and returns
// one point per day for which `pointFor` gives a value, newest first like
// Google does.
export function fakeRollup(pointFor: (date: string) => object | undefined) {
  return (init?: RequestInit) => {
    const { range } = JSON.parse(init!.body as string);
    const end = fromCivil(range.end.date); // exclusive, as in Google's API
    const points = [];
    for (let date = fromCivil(range.start.date); date < end; date = addDays(date, 1)) {
      const fields = pointFor(date);
      if (fields) points.push({ civilStartTime: { date: toCivil(date) }, ...fields });
    }
    return json({ rollupDataPoints: points.reverse() });
  };
}

// The [start, end] dates (inclusive) of a dailyRollUp request.
export function requestedRange(init?: RequestInit): [string, string] {
  const { range } = JSON.parse(init!.body as string);
  return [fromCivil(range.start.date), addDays(fromCivil(range.end.date), -1)];
}
