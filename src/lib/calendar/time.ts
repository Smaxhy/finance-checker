/**
 * Timezone-aware calendar helpers. The server runs in UTC, but calendar days
 * must follow the user's timezone (Europe/Brussels by default), so every
 * "which day is this on" question goes through these functions.
 *
 * Day keys are plain "YYYY-MM-DD" strings; arithmetic on them is done in UTC
 * so it is independent of the server's timezone.
 */

export const DEFAULT_TZ = "Europe/Brussels";

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function dayKeyFormatter(tz: string) {
  let f = dayKeyFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dayKeyFormatters.set(tz, f);
  }
  return f;
}

function partsFormatter(tz: string) {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Calendar day (YYYY-MM-DD) of an instant in the given timezone. Date-only strings pass through. */
export function dayKeyInTz(value: Date | string, tz = DEFAULT_TZ): string {
  if (typeof value === "string" && isDateOnly(value)) return value;
  const d = typeof value === "string" ? new Date(value) : value;
  return dayKeyFormatter(tz).format(d);
}

/** "09:15" in the given timezone. */
export function timeInTz(value: Date | string, tz = DEFAULT_TZ): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

/** Offset of `tz` from UTC at the given instant, in minutes (Brussels: +60 or +120). */
export function tzOffsetMinutes(instant: Date, tz = DEFAULT_TZ): number {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Wall-clock date + time in `tz` → UTC instant. Handles DST transitions. */
export function zonedToUtc(date: string, time = "00:00", tz = DEFAULT_TZ): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let ts = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(new Date(ts), tz);
  if (off2 !== off1) ts = guess - off2 * 60_000;
  return new Date(ts);
}

// ---- Day-key arithmetic (pure, UTC-based) ---------------------------------

function keyToUtc(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function utcToKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysKey(key: string, days: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToKey(d);
}

/** Monday = 0 … Sunday = 6 */
export function weekdayIndex(key: string): number {
  return (keyToUtc(key).getUTCDay() + 6) % 7;
}

export function startOfWeekKey(key: string): string {
  return addDaysKey(key, -weekdayIndex(key));
}

export function monthKeyOf(key: string): string {
  return key.slice(0, 7);
}

export function addMonthsToMonthKey(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return utcToKey(d).slice(0, 7);
}

export function daysBetweenKeys(a: string, b: string): number {
  return Math.round((keyToUtc(b).getTime() - keyToUtc(a).getTime()) / 86_400_000);
}

/** 6 rows × 7 days, Monday-first, covering the month. */
export function monthGridKeys(month: string): string[] {
  const first = `${month}-01`;
  const start = startOfWeekKey(first);
  return Array.from({ length: 42 }, (_, i) => addDaysKey(start, i));
}

export function weekKeys(anyDayInWeek: string): string[] {
  const start = startOfWeekKey(anyDayInWeek);
  return Array.from({ length: 7 }, (_, i) => addDaysKey(start, i));
}

/** Add calendar months to a day key, clamping to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonthsKey(key: string, months: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return utcToKey(target);
}

// ---- Display ---------------------------------------------------------------

export function formatDayKey(key: string, options: Intl.DateTimeFormatOptions, locale = "en-BE"): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(keyToUtc(key));
}

export function formatMonthKey(month: string, locale = "en-BE"): string {
  return formatDayKey(`${month}-01`, { month: "long", year: "numeric" }, locale);
}

export function relativeDayKey(key: string, todayKey: string): string {
  const diff = daysBetweenKeys(todayKey, key);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return formatDayKey(key, { weekday: "long" });
  return formatDayKey(key, { weekday: "short", day: "numeric", month: "short" });
}
