// Calendar-date helpers working on "YYYY-MM-DD" strings, like the backend.
// Dates are handled as UTC midnight so no time zone can shift a day.

const toUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

// Every date from start to end, inclusive.
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  return dates;
}

const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...options });

const dayMonth = fmt({ day: "numeric", month: "short" });
const dayMonthYear = fmt({ day: "numeric", month: "short", year: "numeric" });
const weekdayDay = fmt({ weekday: "short", day: "numeric" });
const month = fmt({ month: "short" });
const full = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const formatDayMonth = (date: string) => dayMonth.format(toUtc(date));
export const formatDayMonthYear = (date: string) => dayMonthYear.format(toUtc(date));
export const formatWeekdayDay = (date: string) => weekdayDay.format(toUtc(date));
export const formatMonth = (date: string) => month.format(toUtc(date));
export const formatFull = (date: string) => full.format(toUtc(date));

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

// "just now", "4 minutes ago", "2 hours ago", "yesterday"...
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}
