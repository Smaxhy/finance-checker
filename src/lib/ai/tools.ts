import "server-only";
/**
 * Data tools for the AI assistant. Each function reads ONLY the signed-in
 * user's data through the user-scoped (RLS) Supabase client and returns
 * compact, exact JSON. The model is instructed to answer only from these
 * results, so every number it states can be traced back to stored data.
 */
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { BillingCycle, SubscriptionStatus, TransactionKind } from "@/lib/types";
import { listTransactions, spendingByCategory, spendingByMerchant, spendingByPeriod } from "@/lib/data/finance";
import { getUpcoming } from "@/lib/engines/upcoming";
import { loadInsights } from "@/lib/engines/insights-loader";
import { addDays, daysBetween, parseISODate, toISODate } from "@/lib/dates";
import { monthlyEquivalent, yearlyEquivalent } from "@/lib/finance/recurring";

const round = (n: number) => Math.round(n * 100) / 100;

export interface ToolContext {
  supabase: AppSupabaseClient;
  userId: string;
  currency: string;
  today: Date;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/** Validates and normalises a date range; rejects inverted or > 3-year ranges. */
export function normaliseRange(from: string, to: string): { from: string; to: string; days: number } {
  const f = parseISODate(from);
  const t = parseISODate(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw new Error("Dates must be YYYY-MM-DD");
  const [a, b] = f <= t ? [f, t] : [t, f];
  const days = daysBetween(a, b) + 1;
  if (days > 1100) throw new Error("Date range too long (max ~3 years)");
  return { from: toISODate(a), to: toISODate(b), days };
}

export interface PeriodTotals {
  spent: number;
  income: number;
  refunds: number;
  net: number;
  transactions: number;
}

export function totalsFromPoints(points: { spent: number; income: number; refunds: number; tx_count: number }[]): PeriodTotals {
  const spent = points.reduce((a, p) => a + p.spent, 0);
  const income = points.reduce((a, p) => a + p.income, 0);
  const refunds = points.reduce((a, p) => a + p.refunds, 0);
  return { spent: round(spent), income: round(income), refunds: round(refunds), net: round(income - spent), transactions: points.reduce((a, p) => a + p.tx_count, 0) };
}

export function pctDiff(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function compareCategoryLists(
  a: { category_id: string; spent: number }[],
  b: { category_id: string; spent: number }[],
  names: Map<string, string>,
) {
  const ids = new Set([...a.map((x) => x.category_id), ...b.map((x) => x.category_id)]);
  const am = new Map(a.map((x) => [x.category_id, x.spent]));
  const bm = new Map(b.map((x) => [x.category_id, x.spent]));
  return [...ids]
    .map((id) => {
      const va = round(am.get(id) ?? 0);
      const vb = round(bm.get(id) ?? 0);
      return { category: names.get(id) ?? id, period_a: va, period_b: vb, difference: round(va - vb), change_pct: pctDiff(va, vb) };
    })
    .sort((x, y) => Math.abs(y.difference) - Math.abs(x.difference));
}

export interface SubscriptionRow {
  id: string;
  name: string;
  amount: number | string | null;
  currency: string;
  billing_cycle: BillingCycle;
  status: SubscriptionStatus;
  category_id: string | null;
  next_payment_date: string | null;
  last_payment_date: string | null;
  trial_ends_at: string | null;
  detection_source: string;
  last_email_at: string | null;
  last_reviewed_at: string | null;
  user_confirmed: boolean;
  cancellation_requested_at: string | null;
  cancellation_confirmed_at: string | null;
  payment_method: string | null;
  is_demo: boolean;
}

/**
 * The app can't see whether you actually *use* a service, so "not interacted
 * with recently" means: no email from the provider and no review by you in
 * the last 90 days. The assistant is told to say exactly that.
 */
export function shapeSubscriptions(rows: SubscriptionRow[], today: Date) {
  const cutoff = addDays(today, -90).toISOString();
  const items = rows.map((s) => {
    const amount = s.amount === null ? null : Number(s.amount);
    const lastInteraction = [s.last_email_at, s.last_reviewed_at].filter(Boolean).sort().pop() ?? null;
    return {
      name: s.name,
      status: s.status,
      type: s.category_id === "subscriptions" ? "subscription" : s.category_id === "housing" ? "housing (rent/mortgage)" : s.category_id === "bills" ? "bill" : (s.category_id ?? "other"),
      amount,
      currency: s.currency,
      billing_cycle: s.billing_cycle,
      monthly_equivalent: round(monthlyEquivalent(amount, s.billing_cycle)),
      yearly_equivalent: round(yearlyEquivalent(amount, s.billing_cycle)),
      next_payment_date: s.next_payment_date,
      last_payment_date: s.last_payment_date,
      trial_ends_at: s.trial_ends_at,
      payment_method: s.payment_method,
      detected_from: s.detection_source,
      confirmed_by_user: s.user_confirmed,
      cancellation_requested_at: s.cancellation_requested_at,
      cancellation_confirmed_at: s.cancellation_confirmed_at,
      last_interaction: lastInteraction,
      possibly_forgotten: (s.status === "active" || s.status === "trial") && (!lastInteraction || lastInteraction < cutoff),
      is_demo: s.is_demo,
    };
  });
  const active = items.filter((i) => i.status === "active" || i.status === "trial" || i.status === "cancellation_pending");
  return {
    items: items.sort((a, b) => b.monthly_equivalent - a.monthly_equivalent),
    totals_for_active: {
      count: active.length,
      monthly: round(active.reduce((a, i) => a + i.monthly_equivalent, 0)),
      yearly: round(active.reduce((a, i) => a + i.yearly_equivalent, 0)),
    },
  };
}

// ---------------------------------------------------------------------------
// Data tools
// ---------------------------------------------------------------------------

async function categoryNames(supabase: AppSupabaseClient): Promise<Map<string, string>> {
  const { data } = await supabase.from("categories").select("id, name");
  return new Map(((data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
}

async function demoShare(ctx: ToolContext, from: string, to: string) {
  const [all, demo] = await Promise.all([
    ctx.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).gte("booked_at", from).lte("booked_at", to),
    ctx.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).eq("is_demo", true).gte("booked_at", from).lte("booked_at", to),
  ]);
  const total = all.count ?? 0;
  const demoCount = demo.count ?? 0;
  return { includes_demo_data: demoCount > 0, demo_transactions: demoCount, total_transactions: total };
}

export async function toolSpendingSummary(ctx: ToolContext, input: { from: string; to: string }) {
  const r = normaliseRange(input.from, input.to);
  const [points, demo] = await Promise.all([spendingByPeriod(ctx.supabase, r.from, r.to, "month", ctx.userId), demoShare(ctx, r.from, r.to)]);
  const totals = totalsFromPoints(points);
  return {
    period: r,
    currency: ctx.currency,
    ...totals,
    average_daily_spending: round(totals.spent / r.days),
    by_month: points.map((p) => ({ month: p.period.slice(0, 7), spent: round(p.spent), income: round(p.income) })),
    note: "Spending = expenses + cash withdrawals + fees minus refunds. Transfers between the user's own accounts are excluded.",
    ...demo,
    empty: totals.transactions === 0,
  };
}

export async function toolSpendingByCategory(ctx: ToolContext, input: { from: string; to: string }) {
  const r = normaliseRange(input.from, input.to);
  const [rows, names] = await Promise.all([spendingByCategory(ctx.supabase, r.from, r.to, ctx.userId), categoryNames(ctx.supabase)]);
  const total = rows.reduce((a, c) => a + c.spent, 0);
  return {
    period: r,
    currency: ctx.currency,
    total_spent: round(total),
    categories: rows.map((c) => ({
      category_id: c.category_id,
      category: names.get(c.category_id) ?? c.category_id,
      spent: round(c.spent),
      share_pct: total ? Math.round((c.spent / total) * 1000) / 10 : 0,
      transactions: c.tx_count,
    })),
    empty: rows.length === 0,
  };
}

export async function toolCategoryTrend(ctx: ToolContext, input: { category_id: string; months: number }) {
  const months = Math.min(Math.max(input.months, 1), 24);
  const start = new Date(ctx.today.getFullYear(), ctx.today.getMonth() - (months - 1), 1);
  const end = new Date(ctx.today.getFullYear(), ctx.today.getMonth() + 1, 0);
  const rows = (
    await Promise.all(
      Array.from({ length: months }, async (_, i) => {
        const ms = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const me = new Date(ms.getFullYear(), ms.getMonth() + 1, 0);
        const cats = await spendingByCategory(ctx.supabase, toISODate(ms), toISODate(me), ctx.userId);
        const hit = cats.find((c) => c.category_id === input.category_id);
        return { month: toISODate(ms).slice(0, 7), spent: round(hit?.spent ?? 0), transactions: hit?.tx_count ?? 0, complete_month: me < ctx.today };
      }),
    )
  ).sort((a, b) => a.month.localeCompare(b.month));
  const complete = rows.filter((r) => r.complete_month);
  const names = await categoryNames(ctx.supabase);
  return {
    category: names.get(input.category_id) ?? input.category_id,
    currency: ctx.currency,
    period: { from: toISODate(start), to: toISODate(end) },
    months: rows,
    average_per_complete_month: complete.length ? round(complete.reduce((a, r) => a + r.spent, 0) / complete.length) : null,
    note: "The current month is incomplete and excluded from the average.",
  };
}

export async function toolSpendingByMerchant(ctx: ToolContext, input: { from: string; to: string; merchant?: string; limit?: number }) {
  const r = normaliseRange(input.from, input.to);
  if (!input.merchant) {
    const rows = await spendingByMerchant(ctx.supabase, r.from, r.to, Math.min(input.limit ?? 15, 50), ctx.userId);
    return {
      period: r,
      currency: ctx.currency,
      merchants: rows.map((m) => ({ merchant: m.merchant, spent: round(m.spent), transactions: m.tx_count, last_purchase: m.last_seen })),
      empty: rows.length === 0,
    };
  }
  const { rows, count } = await listTransactions(ctx.supabase, { from: r.from, to: r.to, q: input.merchant, kind: "spending", limit: 500 });
  const spent = rows.reduce((a, t) => a - t.amount, 0);
  const dates = rows.map((t) => t.booked_at).sort();
  return {
    period: r,
    currency: ctx.currency,
    merchant_query: input.merchant,
    matched_transactions: count,
    spent: round(spent),
    first_purchase: dates[0] ?? null,
    last_purchase: dates[dates.length - 1] ?? null,
    merchants_matched: [...new Set(rows.map((t) => t.merchant ?? t.counterparty_name ?? "Unknown"))].slice(0, 10),
    recent: rows.slice(0, 10).map((t) => ({ date: t.booked_at, merchant: t.merchant, amount: t.amount, is_demo: t.is_demo })),
    includes_demo_data: rows.some((t) => t.is_demo),
    note: "Matched on merchant, counterparty and description text. Refunds reduce the total.",
  };
}

export async function toolListTransactions(
  ctx: ToolContext,
  input: { from?: string; to?: string; category_id?: string; merchant?: string; kind?: TransactionKind | "spending"; min_amount?: number; sort?: "date" | "amount"; limit?: number },
) {
  const r = input.from && input.to ? normaliseRange(input.from, input.to) : null;
  const limit = Math.min(input.limit ?? 20, 50);
  const { rows, count } = await listTransactions(ctx.supabase, {
    from: r?.from,
    to: r?.to,
    categoryId: input.category_id,
    q: input.merchant,
    kind: input.kind,
    minAmount: input.min_amount,
    limit: input.sort === "amount" ? 1000 : limit,
  });
  const sorted = input.sort === "amount" ? [...rows].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, limit) : rows.slice(0, limit);
  return {
    period: r,
    currency: ctx.currency,
    total_matching: count,
    returned: sorted.length,
    transactions: sorted.map((t) => ({
      date: t.booked_at,
      merchant: t.merchant ?? t.counterparty_name,
      description: t.description?.slice(0, 80) ?? null,
      amount: t.amount,
      currency: t.currency,
      kind: t.kind,
      category_id: t.category_id,
      is_demo: t.is_demo,
    })),
    empty: count === 0,
  };
}

export async function toolComparePeriods(ctx: ToolContext, input: { a_from: string; a_to: string; b_from: string; b_to: string }) {
  const a = normaliseRange(input.a_from, input.a_to);
  const b = normaliseRange(input.b_from, input.b_to);
  const [pa, pb, ca, cb, names] = await Promise.all([
    spendingByPeriod(ctx.supabase, a.from, a.to, "month", ctx.userId),
    spendingByPeriod(ctx.supabase, b.from, b.to, "month", ctx.userId),
    spendingByCategory(ctx.supabase, a.from, a.to, ctx.userId),
    spendingByCategory(ctx.supabase, b.from, b.to, ctx.userId),
    categoryNames(ctx.supabase),
  ]);
  const ta = totalsFromPoints(pa);
  const tb = totalsFromPoints(pb);
  return {
    currency: ctx.currency,
    period_a: { ...a, ...ta },
    period_b: { ...b, ...tb },
    spending_change_pct: pctDiff(ta.spent, tb.spent),
    income_change_pct: pctDiff(ta.income, tb.income),
    by_category: compareCategoryLists(ca, cb, names).slice(0, 12),
    note: a.days !== b.days ? `Periods have different lengths (${a.days} vs ${b.days} days) - mention this when comparing.` : undefined,
  };
}

export async function toolListSubscriptions(ctx: ToolContext, input: { status?: SubscriptionStatus | "all" }) {
  let q = ctx.supabase
    .from("subscriptions")
    .select(
      "id, name, amount, currency, billing_cycle, status, category_id, next_payment_date, last_payment_date, trial_ends_at, detection_source, last_email_at, last_reviewed_at, user_confirmed, cancellation_requested_at, cancellation_confirmed_at, payment_method, is_demo",
    )
    .eq("user_id", ctx.userId)
    .eq("dismissed", false);
  if (input.status && input.status !== "all") q = q.eq("status", input.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const shaped = shapeSubscriptions((data ?? []) as SubscriptionRow[], ctx.today);
  return {
    currency: ctx.currency,
    status_filter: input.status ?? "all",
    ...shaped,
    note: "Includes subscriptions and recurring bills (rent, utilities, insurance). 'possibly_forgotten' = no email from the provider and no review by the user in 90 days; the app cannot see actual usage of a service.",
    empty: shaped.items.length === 0,
  };
}

export async function toolUpcoming(ctx: ToolContext, input: { days: number; from?: string }) {
  const days = Math.min(Math.max(input.days, 1), 120);
  const from = input.from ? parseISODate(input.from) : ctx.today;
  const items = await getUpcoming(ctx.supabase, ctx.userId, { days, from });
  const payments = items.filter((i) => i.isExpense && i.amount);
  return {
    currency: ctx.currency,
    window: { from: toISODate(from), to: toISODate(addDays(from, days)) },
    items: items.map((i) => ({
      date: i.date,
      all_day: i.allDay,
      type: i.kind === "event" ? (i.eventKind ?? "event") : i.kind,
      title: i.title,
      detail: i.subtitle ?? null,
      amount: i.amount ?? null,
      currency: i.currency ?? null,
      is_demo: i.isDemo,
    })),
    expected_payments_total: round(payments.reduce((a, i) => a + (i.amount ?? 0), 0)),
    expected_payments_count: payments.length,
    empty: items.length === 0,
  };
}

export async function toolSearchEmails(ctx: ToolContext, input: { query?: string; category?: string; from?: string; to?: string; limit?: number }) {
  let q = ctx.supabase
    .from("emails")
    .select("received_at, from_name, from_email, subject, category, merchant, amount, currency, order_number, due_date, event_start, event_end, location, is_important, is_demo")
    .eq("user_id", ctx.userId)
    .order("received_at", { ascending: false })
    .limit(Math.min(input.limit ?? 25, 100));
  if (input.category) q = q.eq("category", input.category);
  if (input.from) q = q.gte("received_at", `${input.from}T00:00:00`);
  if (input.to) q = q.lte("received_at", `${input.to}T23:59:59`);
  if (input.query?.trim()) {
    const term = input.query.replace(/[%,()]/g, " ").trim();
    q = q.or(`subject.ilike.%${term}%,merchant.ilike.%${term}%,from_name.ilike.%${term}%,from_email.ilike.%${term}%,order_number.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { amount: number | null; currency: string | null; is_demo: boolean }[];
  const totals: Record<string, number> = {};
  for (const e of rows) if (e.amount) totals[e.currency ?? ctx.currency] = round((totals[e.currency ?? ctx.currency] ?? 0) + Number(e.amount));
  return {
    query: input.query ?? null,
    category: input.category ?? null,
    count: rows.length,
    amount_totals_by_currency: totals,
    emails: rows,
    note: "Only structured fields extracted from emails are available (never full email bodies). Amount totals only cover emails where an amount was extracted.",
    empty: rows.length === 0,
  };
}

export async function toolInsights(ctx: ToolContext) {
  const insights = await loadInsights(ctx.supabase, ctx.userId, ctx.today);
  return { insights: insights.map((i) => ({ title: i.title, detail: i.detail ?? null, tone: i.tone })), empty: insights.length === 0 };
}
