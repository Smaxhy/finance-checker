import { addDays, addMonths, endOfMonth, startOfMonth, toISODate } from "@/lib/dates";

export interface ResolvedPeriod {
  from?: string;
  to?: string;
  label: string;
  key: string;
}

/** Turns ?period=…&from=…&to=… search params into a concrete date range. */
export function resolvePeriod(params: { period?: string; from?: string; to?: string }, fallback = "3m", today = new Date()): ResolvedPeriod {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if ((params.from && iso.test(params.from)) || (params.to && iso.test(params.to))) {
    return { from: params.from && iso.test(params.from) ? params.from : undefined, to: params.to && iso.test(params.to) ? params.to : undefined, label: "Custom range", key: "custom" };
  }
  const key = params.period ?? fallback;
  switch (key) {
    case "this-month":
      return { from: toISODate(startOfMonth(today)), to: toISODate(endOfMonth(today)), label: "This month", key };
    case "last-month": {
      const s = addMonths(startOfMonth(today), -1);
      return { from: toISODate(s), to: toISODate(endOfMonth(s)), label: "Last month", key };
    }
    case "6m":
      return { from: toISODate(addMonths(startOfMonth(today), -5)), to: toISODate(today), label: "Last 6 months", key };
    case "12m":
      return { from: toISODate(addMonths(startOfMonth(today), -11)), to: toISODate(today), label: "Last 12 months", key };
    case "ytd":
      return { from: `${today.getFullYear()}-01-01`, to: toISODate(today), label: "This year", key };
    case "all":
      return { label: "All time", key };
    case "30d":
      return { from: toISODate(addDays(today, -29)), to: toISODate(today), label: "Last 30 days", key };
    case "3m":
    default:
      return { from: toISODate(addMonths(startOfMonth(today), -2)), to: toISODate(today), label: "Last 3 months", key: "3m" };
  }
}

export function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
