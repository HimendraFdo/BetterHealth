// Dates in this app are "YYYY-MM-DD" strings with no time zone. Google calls
// these "civil" dates: they mean your local day, wherever you are. Strings
// compare correctly with < and >, because the format is fixed-width.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// `date` shifted by `n` days (n can be negative). Done in UTC so time
// zones and daylight saving can't shift the result.
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const nextDay = (date: string) => addDays(date, 1);

// "YYYY-MM-DD" for a moment in the server's local time zone (the TZ setting).
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Real calendar date? Rejects "2026-02-30", which Date would roll into March.
export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(date);
}

// Whole days from `start` to `end` (0 when they're the same day).
export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

export const minDate = (a: string, b: string) => (a < b ? a : b);
