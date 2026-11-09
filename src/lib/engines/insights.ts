/**
 * Deterministic insight generation. Every statement is computed from stored
 * data (no model is involved), so numbers here can be trusted and audited.
 */
import { SERVICE_GROUP_LABEL } from "@/lib/finance/merchants";
import { findSimilarServices, monthlyEquivalent, type SubscriptionLike } from "@/lib/finance/recurring";
import { formatMoney } from "@/lib/format";

export type InsightTone = "neutral" | "positive" | "warning";

/** Day-to-day categories where month-over-month comparisons are meaningful. */
export const VARIABLE_CATEGORIES = new Set(["groceries", "restaurants", "shopping", "entertainment", "transport", "travel", "health", "cash", "other", "business"]);

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail?: string;
  href?: string;
}

export interface InsightInput {
  currency: string;
  dayOfMonth: number;
  daysInMonth: number;
  monthSpent: number;
  prevMonthSpentToDate: number;
  monthIncome: number;
  categoriesNow: { id: string; name: string; spent: number }[];
  categoriesPrevToDate: { id: string; spent: number }[];
  /** average full-month spend per category over the 3 months before this one */
  categoriesAvg3m: { id: string; spent: number }[];
  subscriptions: (SubscriptionLike & { next_payment_date: string | null; price_changed_at?: string | null; previous_amount?: number | null })[];
  subscriptionChargesThisMonth: number;
  upcomingPaymentsThisWeek: { title: string; amount: number | null }[];
  biggestPurchase?: { merchant: string; amount: number; date: string } | null;
  trialsEndingSoon: { name: string; date: string }[];
}

export function buildInsights(input: InsightInput): Insight[] {
  const fmt = (n: number) => formatMoney(n, input.currency, { decimals: n >= 100 ? 0 : 2 });
  const out: Insight[] = [];

  // Month-over-month total (same number of days, so it's a fair comparison).
  if (input.prevMonthSpentToDate > 0 && input.monthSpent > 0) {
    const change = (input.monthSpent - input.prevMonthSpentToDate) / input.prevMonthSpentToDate;
    if (Math.abs(change) >= 0.1) {
      out.push({
        id: "mom-total",
        tone: change > 0 ? "warning" : "positive",
        title: `You've spent ${Math.abs(Math.round(change * 100))}% ${change > 0 ? "more" : "less"} than at this point last month`,
        detail: `${fmt(input.monthSpent)} so far vs ${fmt(input.prevMonthSpentToDate)} by day ${input.dayOfMonth} last month.`,
        href: "/finances/analytics",
      });
    }
  }

  // Per-category month-over-month changes (to date), only material ones.
  const prev = new Map(input.categoriesPrevToDate.map((c) => [c.id, c.spent]));
  const changes = input.categoriesNow
    .filter((c) => VARIABLE_CATEGORIES.has(c.id) && c.id !== "other")
    .map((c) => ({ ...c, prev: prev.get(c.id) ?? 0 }))
    .filter((c) => c.prev >= 20 && c.spent >= 20)
    .map((c) => ({ ...c, change: (c.spent - c.prev) / c.prev }))
    .filter((c) => Math.abs(c.change) >= 0.25 && Math.abs(c.spent - c.prev) >= 25)
    .sort((a, b) => Math.abs(b.spent - b.prev) - Math.abs(a.spent - a.prev))
    .slice(0, 2);
  for (const c of changes) {
    out.push({
      id: `mom-${c.id}`,
      tone: c.change > 0 ? "warning" : "positive",
      title: `${c.name} spending ${c.change > 0 ? "increased" : "decreased"} by ${Math.abs(Math.round(c.change * 100))}% compared to last month`,
      detail: `${fmt(c.spent)} this month vs ${fmt(c.prev)} over the same days last month.`,
      href: `/finances/transactions?category=${c.id}`,
    });
  }

  // Unusual: a variable category has already passed its typical full month.
  // (Factual - no projection, because lump sums like a one-off purchase make
  // linear "on pace for" extrapolation misleading.)
  const avg = new Map(input.categoriesAvg3m.map((c) => [c.id, c.spent]));
  for (const c of input.categoriesNow) {
    if (!VARIABLE_CATEGORIES.has(c.id)) continue;
    const a = avg.get(c.id) ?? 0;
    if (a < 30 || changes.some((x) => x.id === c.id)) continue;
    if (c.spent >= a * 1.3 && c.spent - a >= 30) {
      out.push({
        id: `over-${c.id}`,
        tone: "warning",
        title: `You've already spent more on ${c.name.toLowerCase()} than in a typical month`,
        detail: `${fmt(c.spent)} so far vs a ${fmt(a)} monthly average over the last 3 months.`,
        href: `/finances/transactions?category=${c.id}`,
      });
    }
  }

  // Biggest variable category (rent and utilities are fixed, so they'd always win).
  const top = [...input.categoriesNow].filter((c) => VARIABLE_CATEGORIES.has(c.id)).sort((a, b) => b.spent - a.spent)[0];
  if (top && input.monthSpent > 0) {
    out.push({
      id: "top-category",
      tone: "neutral",
      title: `Your biggest expense category this month is ${top.name.toLowerCase()}`,
      detail: `${fmt(top.spent)} - ${Math.round((top.spent / input.monthSpent) * 100)}% of everything you've spent. Fixed costs like rent and utilities aren't ranked.`,
      href: `/finances/transactions?category=${top.id}`,
    });
  }

  // Upcoming payments this week.
  if (input.upcomingPaymentsThisWeek.length > 0) {
    const total = input.upcomingPaymentsThisWeek.reduce((a, p) => a + (p.amount ?? 0), 0);
    const n = input.upcomingPaymentsThisWeek.length;
    out.push({
      id: "week-payments",
      tone: "neutral",
      title: `You have ${n} payment${n === 1 ? "" : "s"} coming up this week`,
      detail: `${input.upcomingPaymentsThisWeek.map((p) => p.title).slice(0, 4).join(", ")}${n > 4 ? "…" : ""}${total > 0 ? ` - ${fmt(total)} in total.` : "."}`,
      href: "/calendar/upcoming",
    });
  }

  // Subscriptions.
  const active = input.subscriptions.filter((s) => s.status === "active" || s.status === "trial");
  if (active.length > 0) {
    const monthly = active.reduce((a, s) => a + monthlyEquivalent(s.amount, s.billing_cycle), 0);
    out.push({
      id: "subs-total",
      tone: "neutral",
      title: `You've spent ${fmt(input.subscriptionChargesThisMonth)} on subscriptions this month`,
      detail: `${active.length} active recurring payments, about ${fmt(monthly)} per month or ${fmt(monthly * 12)} per year.`,
      href: "/subscriptions",
    });
  }
  for (const g of findSimilarServices(input.subscriptions)) {
    out.push({
      id: `similar-${g.group}`,
      tone: "warning",
      title: `You might be paying for ${g.subscriptions.length === 2 ? "two" : g.subscriptions.length} similar services`,
      detail: `${g.subscriptions.map((s) => s.name).join(" and ")} are both ${SERVICE_GROUP_LABEL[g.group]}.`,
      href: "/subscriptions/active",
    });
  }
  for (const s of input.subscriptions.filter((x) => x.price_changed_at && x.previous_amount && x.amount && x.amount > x.previous_amount)) {
    out.push({
      id: `price-${s.id}`,
      tone: "warning",
      title: `${s.name} increased its price`,
      detail: `From ${fmt(s.previous_amount!)} to ${fmt(s.amount!)} (${Math.round(((s.amount! - s.previous_amount!) / s.previous_amount!) * 100)}% more).`,
      href: `/subscriptions/${s.id}`,
    });
  }
  for (const t of input.trialsEndingSoon) {
    out.push({ id: `trial-${t.name}`, tone: "warning", title: `${t.name} free trial ends soon`, detail: `It converts to a paid plan on ${t.date} unless you cancel.`, href: "/subscriptions/trials" });
  }

  if (input.biggestPurchase && input.biggestPurchase.amount > 0) {
    out.push({
      id: "biggest",
      tone: "neutral",
      title: `Biggest purchase this month: ${input.biggestPurchase.merchant}`,
      detail: `${fmt(input.biggestPurchase.amount)} on ${input.biggestPurchase.date}.`,
      href: "/finances/analytics",
    });
  }

  if (input.monthIncome > 0 && input.monthSpent > 0) {
    const rate = (input.monthIncome - input.monthSpent) / input.monthIncome;
    out.push({
      id: "savings-rate",
      tone: rate >= 0.1 ? "positive" : rate < 0 ? "warning" : "neutral",
      title: rate >= 0 ? `You've kept ${Math.round(rate * 100)}% of this month's income so far` : `Spending is ahead of income this month`,
      detail: `${fmt(input.monthIncome)} in, ${fmt(input.monthSpent)} out (transfers between your own accounts excluded).`,
      href: "/finances/income",
    });
  }

  return out;
}
