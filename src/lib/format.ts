// Display formatting. Locale defaults to Belgian English with EUR.

const DEFAULT_LOCALE = "en-BE";

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

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  // Plain dates (YYYY-MM-DD) are treated as local calendar dates.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
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
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, options).format(d);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { hour: "2-digit", minute: "2-digit" }).format(toDate(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return `${formatDate(value, "medium")}, ${formatTime(value)}`;
}

export function formatMonth(value: string | Date, style: "short" | "long" = "long"): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { month: style, year: style === "long" ? "numeric" : undefined }).format(toDate(value));
}

/** "today", "tomorrow", "in 3 days", "2 days ago" */
export function relativeDay(value: string | Date, now = new Date()): string {
  const d = toDate(value);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff < 14) return `in ${diff} days`;
  if (diff < -1 && diff > -14) return `${Math.abs(diff)} days ago`;
  return formatDate(d, "short");
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
