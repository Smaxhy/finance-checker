// Calendar-date helpers working on local dates and ISO "YYYY-MM-DD" strings.

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + months);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** Monday-based week start. */
export function startOfWeek(d: Date): Date {
  const r = startOfDay(d);
  const dow = (r.getDay() + 6) % 7;
  return addDays(r, -dow);
}

export function daysBetween(a: Date | string, b: Date | string): number {
  const da = typeof a === "string" ? parseISODate(a) : startOfDay(a);
  const db = typeof b === "string" ? parseISODate(b) : startOfDay(b);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function daysInMonth(d: Date): number {
  return endOfMonth(d).getDate();
}

export interface DateRange {
  from: string;
  to: string;
}

export function monthRange(d: Date): DateRange {
  return { from: toISODate(startOfMonth(d)), to: toISODate(endOfMonth(d)) };
}

/** The same elapsed span in the previous month (e.g. 1–9 Oct vs 1–9 Nov), for fair month-to-date comparison. */
export function previousMonthToDate(today: Date): DateRange {
  const prevStart = startOfMonth(addMonths(startOfMonth(today), -1));
  const prevEnd = endOfMonth(prevStart);
  const day = Math.min(today.getDate(), prevEnd.getDate());
  return { from: toISODate(prevStart), to: toISODate(new Date(prevStart.getFullYear(), prevStart.getMonth(), day)) };
}

export function monthKey(d: Date | string): string {
  const date = typeof d === "string" ? parseISODate(d) : d;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function parseMonthParam(value: string | undefined | null, fallback = new Date()): Date {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }
  return startOfMonth(fallback);
}
