// Display formatting. Locale defaults to Belgian English with EUR.

const DEFAULT_LOCALE = "en-BE";
/** All dates/times are shown in the user's timezone, not the server's (servers usually run in UTC). */
export const DISPLAY_TZ = "Europe/Brussels";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(
  value: number | null | undefined,
  currency = "EUR",
  opts: { sign?: boolean; compact?: boolean; decimals?: number; locale?: string } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const { sign = false, compact = false, locale = DEFAULT_LOCALE } = opts;
  const decimals = opts.decimals ?? (compact ? (Math.abs(value) >= 1000 ? 1 : 0) : 2);
  const key = `${locale}|${currency}|${compact}|${decimals}`;
  let fmt = moneyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    moneyFormatters.set(key, fmt);
  }
  const formatted = fmt.format(Math.abs(value));
  if (value < 0) return `−${formatted}`;
  if (sign && value > 0) return `+${formatted}`;
  return formatted;
}

export function formatPercent(value: number | null | undefined, decimals = 0, sign = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const pct = (value * 100).toFixed(decimals);
  if (!sign) return `${pct}%`;
  return value > 0 ? `+${pct}%` : value < 0 ? `−${Math.abs(Number(pct)).toFixed(decimals)}%` : `${pct}%`;
}

export function formatNumber(value: number, locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale).format(value);
}

function isDateOnly(value: string | Date): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  // Plain dates (YYYY-MM-DD) are calendar dates: anchor at UTC noon and format in UTC.
  if (isDateOnly(value)) return new Date(`${value}T12:00:00Z`);
  return new Date(value);
}

function tzFor(value: string | Date): string {
  return isDateOnly(value) ? "UTC" : DISPLAY_TZ;
}

export function formatDate(value: string | Date | null | undefined, style: "short" | "medium" | "long" = "medium"): string {
  if (!value) return "—";
  const d = toDate(value);
  const options: Intl.DateTimeFormatOptions =
    style === "short"
      ? { day: "numeric", month: "short" }
      : style === "medium"
        ? { day: "numeric", month: "short", year: "numeric" }
        : { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { ...options, timeZone: tzFor(value) }).format(d);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: DISPLAY_TZ }).format(toDate(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return `${formatDate(value, "medium")}, ${formatTime(value)}`;
}

export function formatMonth(value: string | Date, style: "short" | "long" = "long"): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { month: style, year: style === "long" ? "numeric" : undefined, timeZone: tzFor(value) }).format(toDate(value));
}

/** Calendar day (YYYY-MM-DD) of a value in the display timezone. */
export function dayKey(value: string | Date): string {
  if (isDateOnly(value)) return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(toDate(value));
}

/** Day-of-month and short month name in the display timezone (for date badges). */
export function dayParts(value: string | Date): { day: number; month: string } {
  const key = dayKey(value);
  return { day: Number(key.slice(8, 10)), month: new Intl.DateTimeFormat(DEFAULT_LOCALE, { month: "short", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`)) };
}

/** "today", "tomorrow", "in 3 days", "2 days ago" */
export function relativeDay(value: string | Date, now = new Date()): string {
  const diff = Math.round((Date.parse(`${dayKey(value)}T12:00:00Z`) - Date.parse(`${dayKey(now)}T12:00:00Z`)) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff < 14) return `in ${diff} days`;
  if (diff < -1 && diff > -14) return `${Math.abs(diff)} days ago`;
  return formatDate(value, "short");
}

export function relativeTime(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return "never";
  const d = toDate(value);
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d, "medium");
}

export function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  if (clean.length < 8) return clean;
  return `${clean.slice(0, 4)} •••• ${clean.slice(-4)}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
