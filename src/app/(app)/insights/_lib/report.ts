// Pure helpers for the Patterns and Reports pages (unit tested).
import type { BillingCycle } from "@/lib/types";
import { addMonths, parseISODate, toISODate } from "@/lib/dates";

const round = (n: number) => Math.round(n * 100) / 100;

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Average spending per weekday (Monday first) over a densified daily series. */
export function weekdayAverages(daily: { period: string; spent: number }[]) {
  const totals = Array(7).fill(0) as number[];
  const counts = Array(7).fill(0) as number[];
  for (const d of daily) {
    const idx = (parseISODate(d.period).getDay() + 6) % 7;
    totals[idx] += d.spent;
    counts[idx] += 1;
  }
  return WEEKDAYS.map((label, i) => ({ label, total: round(totals[i]), average: counts[i] ? round(totals[i] / counts[i]) : 0, days: counts[i] }));
}

const FIXED_CATEGORIES = new Set(["housing", "bills", "subscriptions"]);

export interface SpendRow {
  booked_at: string;
  amount: number;
  kind: string;
  category_id: string | null;
  subscription_id: string | null;
}

/** Splits monthly spending into recurring/fixed commitments vs day-to-day (variable) spending. */
export function splitRecurringByMonth(rows: SpendRow[], months: string[]) {
  const map = new Map(months.map((m) => [m, { month: m, recurring: 0, variable: 0 }]));
  for (const r of rows) {
    if (!["expense", "withdrawal", "fee", "refund"].includes(r.kind)) continue;
    const bucket = map.get(r.booked_at.slice(0, 7));
    if (!bucket) continue;
    const value = -Number(r.amount); // refunds are positive amounts -> negative spending
    if (r.subscription_id || FIXED_CATEGORIES.has(r.category_id ?? "")) bucket.recurring += value;
    else bucket.variable += value;
  }
  return [...map.values()].map((b) => ({ ...b, recurring: round(b.recurring), variable: round(b.variable) }));
}

export function savingsRate(income: number, spent: number): number | null {
  if (income <= 0) return null;
  return (income - spent) / income;
}

export interface ProjectableSubscription {
  id: string;
  name: string;
  amount: number | null;
  currency: string;
  billing_cycle: BillingCycle;
  status: string;
  next_payment_date: string | null;
  trial_ends_at: string | null;
  is_demo: boolean;
}

const CYCLE_MONTHS: Partial<Record<BillingCycle, number>> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

/**
 * Charges each active subscription is expected to make inside [monthStart, monthEnd],
 * rolling its known next payment date forward by its billing cycle.
 */
export function projectSubscriptionsIntoMonth(subs: ProjectableSubscription[], monthStart: string, monthEnd: string) {
  const out: { id: string; name: string; date: string; amount: number | null; currency: string; is_demo: boolean }[] = [];
  for (const s of subs) {
    if (!["active", "cancellation_pending"].includes(s.status) || !s.next_payment_date) continue;
    if (s.billing_cycle === "weekly") {
      let d = parseISODate(s.next_payment_date);
      for (let guard = 0; toISODate(d) <= monthEnd && guard < 120; guard++) {
        if (toISODate(d) >= monthStart) out.push({ id: s.id, name: s.name, date: toISODate(d), amount: s.amount, currency: s.currency, is_demo: s.is_demo });
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
      }
      continue;
    }
    const step = CYCLE_MONTHS[s.billing_cycle];
    if (!step) {
      if (s.next_payment_date >= monthStart && s.next_payment_date <= monthEnd) out.push({ id: s.id, name: s.name, date: s.next_payment_date, amount: s.amount, currency: s.currency, is_demo: s.is_demo });
      continue;
    }
    let d = parseISODate(s.next_payment_date);
    for (let guard = 0; toISODate(d) < monthStart && guard < 60; guard++) d = addMonths(d, step);
    const iso = toISODate(d);
    if (iso >= monthStart && iso <= monthEnd) out.push({ id: s.id, name: s.name, date: iso, amount: s.amount, currency: s.currency, is_demo: s.is_demo });
  }
  // Trials that convert to paid inside the month.
  for (const s of subs) {
    if (s.status === "trial" && s.trial_ends_at && s.trial_ends_at >= monthStart && s.trial_ends_at <= monthEnd) {
      out.push({ id: s.id, name: `${s.name} (trial converts)`, date: s.trial_ends_at, amount: s.amount, currency: s.currency, is_demo: s.is_demo });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** "2026-11" -> previous/next month keys and the list of the last N month keys ending at `month`. */
export function monthKeys(month: string, n: number): string[] {
  const start = parseISODate(`${month}-01`);
  return Array.from({ length: n }, (_, i) => toISODate(addMonths(start, i - (n - 1))).slice(0, 7));
}

export function shiftMonth(month: string, delta: number): string {
  return toISODate(addMonths(parseISODate(`${month}-01`), delta)).slice(0, 7);
}
