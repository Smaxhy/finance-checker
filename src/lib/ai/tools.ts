/**
 * Data tools for the assistant (both the built-in engine and Claude). Each
 * function reads ONLY the signed-in user's data through the user-scoped (RLS)
 * client and returns compact, exact JSON, so every number in an answer can be
 * traced back to stored data. Holds no secrets: it also runs in the browser
 * in the GitHub Pages edition, against on-device data.
 */
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { BillingCycle, SubscriptionStatus, TransactionKind } from "@/lib/types";
import { listAccounts, listBudgets, listTransactions, spendingByCategory, spendingByMerchant, spendingByPeriod } from "@/lib/data/finance";
import { getUpcoming } from "@/lib/engines/upcoming";
import { loadInsights } from "@/lib/engines/insights-loader";
import { addDays, addMonths, daysBetween, daysInMonth, endOfMonth, monthRange, parseISODate, previousMonthToDate, startOfMonth, toISODate } from "@/lib/dates";
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

/** Mailbox label (the account's email address) per connection id. */
async function mailboxLabels(ctx: ToolContext): Promise<Map<string, string>> {
  const { data } = await ctx.supabase.from("connections").select("id, label, provider").eq("user_id", ctx.userId);
  return new Map(((data ?? []) as { id: string; label: string; provider: string }[]).filter((c) => c.provider === "google").map((c) => [c.id, c.label]));
}

export async function toolSearchEmails(ctx: ToolContext, input: { query?: string; category?: string; from?: string; to?: string; limit?: number; account?: string }) {
  const labels = await mailboxLabels(ctx);
  let q = ctx.supabase
    .from("emails")
    .select("received_at, from_name, from_email, subject, category, merchant, amount, currency, order_number, due_date, event_start, event_end, location, is_important, is_demo, connection_id")
    .eq("user_id", ctx.userId)
    .order("received_at", { ascending: false })
    .limit(Math.min(input.limit ?? 25, 100));
  if (input.category) q = q.eq("category", input.category);
  if (input.account?.trim()) {
    const wanted = input.account.trim().toLowerCase();
    const ids = [...labels].filter(([, label]) => label.toLowerCase().includes(wanted)).map(([id]) => id);
    if (ids.length === 0) return { query: input.query ?? null, category: input.category ?? null, count: 0, emails: [], connected_mailboxes: [...labels.values()], note: `No connected mailbox matches "${input.account}".`, empty: true };
    q = q.in("connection_id", ids);
  }
  if (input.from) q = q.gte("received_at", `${input.from}T00:00:00`);
  if (input.to) q = q.lte("received_at", `${input.to}T23:59:59`);
  if (input.query?.trim()) {
    const term = input.query.replace(/[%,()]/g, " ").trim();
    q = q.or(`subject.ilike.%${term}%,merchant.ilike.%${term}%,from_name.ilike.%${term}%,from_email.ilike.%${term}%,order_number.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as ({ amount: number | null; currency: string | null; is_demo: boolean; connection_id?: string | null } & Record<string, unknown>)[]).map(({ connection_id, ...e }) => ({
    ...e,
    mailbox: connection_id ? (labels.get(connection_id) ?? null) : null,
  }));
  const totals: Record<string, number> = {};
  for (const e of rows) if (e.amount) totals[e.currency ?? ctx.currency] = round((totals[e.currency ?? ctx.currency] ?? 0) + Number(e.amount));
  return {
    query: input.query ?? null,
    category: input.category ?? null,
    count: rows.length,
    amount_totals_by_currency: totals,
    connected_mailboxes: [...labels.values()],
    emails: rows,
    note: "Only structured fields extracted from emails are available (never full email bodies). Amount totals only cover emails where an amount was extracted.",
    empty: rows.length === 0,
  };
}

export async function toolInsights(ctx: ToolContext) {
  const insights = await loadInsights(ctx.supabase, ctx.userId, ctx.today);
  return { insights: insights.map((i) => ({ title: i.title, detail: i.detail ?? null, tone: i.tone })), empty: insights.length === 0 };
}


// ---------------------------------------------------------------------------
// Deeper analysis tools
// ---------------------------------------------------------------------------

export async function toolAccounts(ctx: ToolContext) {
  const accounts = await listAccounts(ctx.supabase);
  const counted = accounts.filter((a) => a.include_in_totals && a.balance !== null);
  const byCurrency: Record<string, number> = {};
  for (const a of counted) byCurrency[a.currency] = round((byCurrency[a.currency] ?? 0) + (a.balance ?? 0));
  return {
    accounts: accounts.map((a) => ({
      name: a.name,
      institution: a.institution,
      type: a.type,
      source: a.source === "bank" ? "bank connection" : a.source === "csv" ? "CSV import" : a.source,
      balance: a.balance,
      currency: a.currency,
      balance_updated_at: a.balance_updated_at,
      counted_in_total: a.include_in_totals,
      is_demo: a.is_demo,
    })),
    total_by_currency: byCurrency,
    note: "Balances come from the bank connection or the last imported CSV; accounts without a known balance are listed with balance null and not counted.",
    includes_demo_data: accounts.some((a) => a.is_demo),
    empty: accounts.length === 0,
  };
}

export async function toolIncome(ctx: ToolContext, input: { from: string; to: string }) {
  const r = normaliseRange(input.from, input.to);
  const { rows, count } = await listTransactions(ctx.supabase, { from: r.from, to: r.to, kind: "income", limit: 1000 });
  const bySource = new Map<string, { total: number; payments: number; last: string }>();
  for (const t of rows) {
    const name = t.merchant ?? t.counterparty_name ?? "Unknown source";
    const cur = bySource.get(name) ?? { total: 0, payments: 0, last: t.booked_at };
    cur.total += t.amount;
    cur.payments += 1;
    if (t.booked_at > cur.last) cur.last = t.booked_at;
    bySource.set(name, cur);
  }
  const total = rows.reduce((a, t) => a + t.amount, 0);
  const months = Math.max(1, Math.round(r.days / 30.44));
  return {
    period: r,
    currency: ctx.currency,
    total_income: round(total),
    payments: count,
    average_per_month: round(total / months),
    sources: [...bySource].map(([source, v]) => ({ source, total: round(v.total), payments: v.payments, last_payment: v.last, share_pct: total ? Math.round((v.total / total) * 1000) / 10 : 0 })).sort((a, b) => b.total - a.total).slice(0, 20),
    note: "Income excludes refunds and transfers between the user's own accounts.",
    includes_demo_data: rows.some((t) => t.is_demo),
    empty: count === 0,
  };
}

export async function toolBudgets(ctx: ToolContext) {
  const cur = monthRange(ctx.today);
  const [budgets, spent, names] = await Promise.all([listBudgets(ctx.supabase), spendingByCategory(ctx.supabase, cur.from, cur.to, ctx.userId), categoryNames(ctx.supabase)]);
  const spentBy = new Map(spent.map((c) => [c.category_id, c.spent]));
  const elapsed = ctx.today.getDate() / daysInMonth(ctx.today);
  const rows = budgets
    .map((b) => {
      const used = round(spentBy.get(b.category_id) ?? 0);
      const projected = elapsed > 0 ? round(used / elapsed) : used;
      return {
        category: names.get(b.category_id) ?? b.category_id,
        monthly_limit: round(b.amount),
        spent_so_far: used,
        remaining: round(b.amount - used),
        used_pct: b.amount ? Math.round((used / b.amount) * 1000) / 10 : null,
        projected_month_end: projected,
        status: used > b.amount ? "over budget" : projected > b.amount ? "on track to exceed" : "on track",
      };
    })
    .sort((a, b) => (b.used_pct ?? 0) - (a.used_pct ?? 0));
  return {
    month: cur.from.slice(0, 7),
    currency: ctx.currency,
    day_of_month: ctx.today.getDate(),
    days_in_month: daysInMonth(ctx.today),
    budgets: rows,
    note: "projected_month_end extrapolates the spending pace so far to the full month; it is a projection, not a fact.",
    empty: rows.length === 0,
  };
}

export async function toolCashFlow(ctx: ToolContext, input: { months: number }) {
  const months = Math.min(Math.max(input.months, 1), 24);
  const start = startOfMonth(addMonths(startOfMonth(ctx.today), -(months - 1)));
  const end = endOfMonth(ctx.today);
  const points = await spendingByPeriod(ctx.supabase, toISODate(start), toISODate(end), "month", ctx.userId);
  const byMonth = new Map(points.map((p) => [p.period.slice(0, 7), p]));
  const rows = Array.from({ length: months }, (_, i) => {
    const m = addMonths(start, i);
    const key = toISODate(m).slice(0, 7);
    const p = byMonth.get(key);
    const income = round(p?.income ?? 0);
    const spent = round(p?.spent ?? 0);
    return { month: key, income, spent, net: round(income - spent), savings_rate_pct: income > 0 ? Math.round(((income - spent) / income) * 1000) / 10 : null, complete_month: endOfMonth(m) < ctx.today };
  });
  const complete = rows.filter((r) => r.complete_month && (r.income > 0 || r.spent > 0));
  const avg = (k: "income" | "spent" | "net") => (complete.length ? round(complete.reduce((a, r) => a + r[k], 0) / complete.length) : null);
  return {
    currency: ctx.currency,
    period: { from: toISODate(start), to: toISODate(end) },
    months: rows,
    averages_over_complete_months: { income: avg("income"), spent: avg("spent"), net: avg("net") },
    note: "net = income - spending. The current month is incomplete and excluded from the averages.",
    empty: rows.every((r) => r.income === 0 && r.spent === 0),
  };
}

/** Possible duplicate charges, purchases above the user's "large purchase" threshold, and first-time merchants. */
export async function toolUnusual(ctx: ToolContext, input: { days?: number }) {
  const days = Math.min(Math.max(input.days ?? 45, 7), 180);
  const from = toISODate(addDays(ctx.today, -days));
  const to = toISODate(ctx.today);
  const [{ rows }, history, profileRes] = await Promise.all([
    listTransactions(ctx.supabase, { from, to, kind: "spending", limit: 1000 }),
    ctx.supabase.from("transactions").select("merchant_key").eq("user_id", ctx.userId).lt("booked_at", from).gte("booked_at", toISODate(addDays(ctx.today, -400))).not("merchant_key", "is", null).limit(20000),
    ctx.supabase.from("profiles").select("large_purchase_threshold").eq("id", ctx.userId).maybeSingle(),
  ]);
  const threshold = Number((profileRes.data as { large_purchase_threshold?: number } | null)?.large_purchase_threshold ?? 150) || 150;
  const expenses = rows.filter((t) => t.amount < 0 && t.kind !== "refund");
  const shape = (t: (typeof rows)[number]) => ({ date: t.booked_at, merchant: t.merchant ?? t.counterparty_name ?? "Unknown", amount: round(-t.amount), category_id: t.category_id, is_demo: t.is_demo });

  // Same merchant + same amount within 2 days, not a known recurring charge.
  const duplicates: { merchant: string; amount: number; dates: string[] }[] = [];
  const groups = new Map<string, typeof expenses>();
  for (const t of expenses) {
    if (-t.amount < 10 || t.subscription_id) continue;
    const key = `${t.merchant_key ?? t.merchant ?? t.counterparty_name ?? "?"}|${t.amount}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.booked_at.localeCompare(b.booked_at));
    for (let i = 1; i < sorted.length; i++) {
      if (daysBetween(sorted[i - 1].booked_at, sorted[i].booked_at) <= 2) {
        duplicates.push({ merchant: sorted[i].merchant ?? sorted[i].counterparty_name ?? "Unknown", amount: round(-sorted[i].amount), dates: [sorted[i - 1].booked_at, sorted[i].booked_at] });
        break;
      }
    }
  }

  const large = expenses.filter((t) => -t.amount >= threshold && t.category_id !== "housing" && !t.subscription_id).sort((a, b) => a.amount - b.amount).slice(0, 10).map(shape);

  const seenBefore = new Set(((history.data ?? []) as { merchant_key: string }[]).map((r) => r.merchant_key));
  const firstTime = new Map<string, { merchant: string; spent: number; first: string; count: number }>();
  if (seenBefore.size > 0) {
    for (const t of expenses) {
      if (!t.merchant_key || seenBefore.has(t.merchant_key)) continue;
      const cur = firstTime.get(t.merchant_key) ?? { merchant: t.merchant ?? t.merchant_key, spent: 0, first: t.booked_at, count: 0 };
      cur.spent += -t.amount;
      cur.count += 1;
      if (t.booked_at < cur.first) cur.first = t.booked_at;
      firstTime.set(t.merchant_key, cur);
    }
  }
  const newMerchants = [...firstTime.values()].filter((m) => m.spent >= 40).sort((a, b) => b.spent - a.spent).slice(0, 8).map((m) => ({ merchant: m.merchant, spent: round(m.spent), purchases: m.count, first_seen: m.first }));

  return {
    period: { from, to, days },
    currency: ctx.currency,
    possible_duplicate_charges: duplicates.slice(0, 10),
    large_purchases: large,
    large_purchase_threshold: threshold,
    new_merchants: newMerchants,
    note: "Possible duplicates are two charges of the same amount at the same merchant within 2 days - they can be legitimate (e.g. two identical purchases). New merchants are compared with the previous 13 months of history.",
    includes_demo_data: expenses.some((t) => t.is_demo),
    empty: duplicates.length === 0 && large.length === 0 && newMerchants.length === 0,
  };
}

interface DigestEmail {
  received_at: string;
  from_name: string | null;
  subject: string | null;
  category: string;
  merchant: string | null;
  amount: number | null;
  currency: string | null;
  due_date: string | null;
  event_start: string | null;
  location: string | null;
  is_important: boolean;
  extracted: Record<string, unknown> | null;
  connection_id: string | null;
  is_demo: boolean;
}

/** What arrived in the connected mailboxes recently, grouped so nothing important is missed. */
export async function toolEmailDigest(ctx: ToolContext, input: { days?: number }) {
  const days = Math.min(Math.max(input.days ?? 7, 1), 60);
  const since = addDays(ctx.today, -days);
  const todayIso = toISODate(ctx.today);
  const [labels, res] = await Promise.all([
    mailboxLabels(ctx),
    ctx.supabase
      .from("emails")
      .select("received_at, from_name, subject, category, merchant, amount, currency, due_date, event_start, location, is_important, extracted, connection_id, is_demo")
      .eq("user_id", ctx.userId)
      .gte("received_at", since.toISOString())
      .order("received_at", { ascending: false })
      .limit(400),
  ]);
  if (res.error) throw new Error(res.error.message);
  const rows = (res.data ?? []) as DigestEmail[];
  const mailbox = (e: DigestEmail) => (e.connection_id ? (labels.get(e.connection_id) ?? null) : null);
  const brief = (e: DigestEmail) => ({
    date: e.received_at.slice(0, 10),
    from: e.merchant ?? e.from_name,
    subject: e.subject?.slice(0, 120) ?? null,
    amount: e.amount === null ? null : Number(e.amount),
    currency: e.currency,
    mailbox: mailbox(e),
    is_demo: e.is_demo,
  });
  const perMailbox = new Map<string, number>();
  const perCategory: Record<string, number> = {};
  for (const e of rows) {
    const label = mailbox(e) ?? (e.is_demo ? "sample data" : "disconnected mailbox");
    perMailbox.set(label, (perMailbox.get(label) ?? 0) + 1);
    perCategory[e.category] = (perCategory[e.category] ?? 0) + 1;
  }
  const x = (e: DigestEmail) => e.extracted ?? {};
  return {
    window: { from: toISODate(since), to: todayIso, days },
    connected_mailboxes: [...labels.values()],
    total_relevant_emails: rows.length,
    by_mailbox: [...perMailbox].map(([mailbox, count]) => ({ mailbox, count })),
    by_category: perCategory,
    bills_to_pay: rows.filter((e) => e.category === "bill").map((e) => ({ ...brief(e), due_date: e.due_date, overdue: Boolean(e.due_date && e.due_date < todayIso) })).slice(0, 15),
    trials_and_renewals: rows
      .filter((e) => e.category === "trial" || e.category === "renewal")
      .map((e) => ({ ...brief(e), kind: e.category, trial_end_date: (x(e).trial_end_date as string | undefined) ?? null, renewal_date: (x(e).renewal_date as string | undefined) ?? null }))
      .slice(0, 15),
    deliveries: rows.filter((e) => e.category === "shipping").map((e) => ({ ...brief(e), delivery_date: (x(e).delivery_date as string | undefined) ?? null, carrier: (x(e).carrier as string | undefined) ?? null })).slice(0, 15),
    bookings_and_appointments: rows
      .filter((e) => ["booking", "travel", "appointment"].includes(e.category) && (!e.event_start || e.event_start.slice(0, 10) >= todayIso))
      .map((e) => ({ ...brief(e), kind: e.category, starts: e.event_start, location: e.location }))
      .slice(0, 15),
    receipts_and_orders: rows.filter((e) => ["receipt", "order", "purchase"].includes(e.category)).map(brief).slice(0, 20),
    cancellations: rows.filter((e) => e.category === "cancellation").map(brief).slice(0, 10),
    other_important: rows.filter((e) => e.is_important && ["important", "other", "subscription"].includes(e.category)).map(brief).slice(0, 15),
    note: "Only transactional and important emails are stored (newsletters, promotions and personal mail are skipped), and only structured fields - never email bodies. Whether a bill has been paid is not known from the email alone.",
    includes_demo_data: rows.some((e) => e.is_demo),
    empty: rows.length === 0,
  };
}

/** Which data sources are connected, so the assistant can explain missing data instead of guessing. */
export async function toolSources(ctx: ToolContext) {
  const count = async (table: string, demo?: boolean) => {
    let q = ctx.supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", ctx.userId);
    if (demo !== undefined) q = q.eq("is_demo", demo);
    return (await q).count ?? 0;
  };
  const [connRes, accounts, tx, demoTx, emails, events, subs, firstTx, lastTx] = await Promise.all([
    ctx.supabase.from("connections").select("provider, label, status, scopes, last_synced_at, last_error").eq("user_id", ctx.userId),
    listAccounts(ctx.supabase),
    count("transactions"),
    count("transactions", true),
    count("emails"),
    count("events"),
    count("subscriptions"),
    ctx.supabase.from("transactions").select("booked_at").eq("user_id", ctx.userId).order("booked_at", { ascending: true }).limit(1),
    ctx.supabase.from("transactions").select("booked_at").eq("user_id", ctx.userId).order("booked_at", { ascending: false }).limit(1),
  ]);
  const connections = (connRes.data ?? []) as { provider: string; label: string; status: string; scopes: string[]; last_synced_at: string | null; last_error: string | null }[];
  return {
    connections: connections.map((c) => ({
      type: c.provider === "google" ? "Google account" : "Bank connection",
      label: c.label,
      status: c.status,
      reads: c.provider === "google" ? [c.scopes.some((s) => s.includes("gmail")) && "email (read-only)", c.scopes.some((s) => s.includes("calendar")) && "calendar (read-only)"].filter(Boolean) : ["balances and transactions (read-only)"],
      last_checked: c.last_synced_at,
      problem: c.last_error,
    })),
    accounts: accounts.map((a) => ({ name: a.name, source: a.source })),
    stored: { transactions: tx, demo_transactions: demoTx, emails, calendar_events: events, subscriptions: subs },
    transactions_cover: { from: (firstTx.data?.[0] as { booked_at?: string } | undefined)?.booked_at ?? null, to: (lastTx.data?.[0] as { booked_at?: string } | undefined)?.booked_at ?? null },
    empty: connections.length === 0 && tx === 0 && emails === 0 && events === 0,
  };
}

export async function toolNotifications(ctx: ToolContext, input: { unread_only?: boolean; limit?: number }) {
  let q = ctx.supabase.from("notifications").select("type, title, body, severity, created_at, read_at, is_demo").eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(Math.min(input.limit ?? 20, 50));
  if (input.unread_only ?? true) q = q.is("read_at", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { type: string; title: string; body: string | null; severity: string; created_at: string; read_at: string | null; is_demo: boolean }[];
  return {
    alerts: rows.map((n) => ({ type: n.type, title: n.title, detail: n.body, severity: n.severity, date: n.created_at.slice(0, 10), unread: !n.read_at, is_demo: n.is_demo })),
    count: rows.length,
    empty: rows.length === 0,
  };
}

/**
 * Everything worth looking at, in one call: this month vs last month, top
 * categories, subscriptions, what is due, unusual charges, budgets, recent
 * email and alerts.
 */
export async function toolCheckup(ctx: ToolContext) {
  const cur = monthRange(ctx.today);
  const mtd = { from: cur.from, to: toISODate(ctx.today) };
  const prev = previousMonthToDate(ctx.today);
  const [compare, categories, subs, upcoming, unusual, budgets, digest, alerts, insights, sources, accounts] = await Promise.all([
    toolComparePeriods(ctx, { a_from: mtd.from, a_to: mtd.to, b_from: prev.from, b_to: prev.to }),
    toolSpendingByCategory(ctx, mtd),
    toolListSubscriptions(ctx, { status: "all" }),
    toolUpcoming(ctx, { days: 14 }),
    toolUnusual(ctx, { days: 45 }),
    toolBudgets(ctx),
    toolEmailDigest(ctx, { days: 14 }),
    toolNotifications(ctx, { unread_only: true, limit: 15 }),
    toolInsights(ctx),
    toolSources(ctx),
    toolAccounts(ctx),
  ]);
  const live = subs.items.filter((s) => s.status === "active" || s.status === "trial" || s.status === "cancellation_pending");
  return {
    date: toISODate(ctx.today),
    currency: ctx.currency,
    this_month_so_far: { ...compare.period_a, vs_same_days_last_month: { spent: compare.period_b.spent, income: compare.period_b.income, spending_change_pct: compare.spending_change_pct } },
    top_categories: categories.categories.slice(0, 6),
    biggest_category_changes: compare.by_category.slice(0, 5),
    balances: accounts.empty ? null : accounts.total_by_currency,
    subscriptions: {
      ...subs.totals_for_active,
      most_expensive: live.slice(0, 5).map((s) => ({ name: s.name, monthly_equivalent: s.monthly_equivalent, next_payment_date: s.next_payment_date })),
      possibly_forgotten: live.filter((s) => s.possibly_forgotten && s.type === "subscription").map((s) => ({ name: s.name, monthly_equivalent: s.monthly_equivalent })),
      trials: live.filter((s) => s.status === "trial").map((s) => ({ name: s.name, trial_ends_at: s.trial_ends_at, amount_after: s.amount })),
      cancellation_pending: live.filter((s) => s.status === "cancellation_pending").map((s) => ({ name: s.name, requested_at: s.cancellation_requested_at })),
    },
    next_14_days: { expected_payments_total: upcoming.expected_payments_total, expected_payments_count: upcoming.expected_payments_count, items: upcoming.items.slice(0, 25) },
    unusual: { possible_duplicate_charges: unusual.possible_duplicate_charges, large_purchases: unusual.large_purchases.slice(0, 5), new_merchants: unusual.new_merchants.slice(0, 5) },
    budgets: budgets.budgets.filter((b) => b.status !== "on track"),
    budgets_set: budgets.budgets.length,
    email_last_14_days: digest.empty
      ? null
      : { connected_mailboxes: digest.connected_mailboxes, total: digest.total_relevant_emails, bills_to_pay: digest.bills_to_pay, trials_and_renewals: digest.trials_and_renewals, deliveries: digest.deliveries.slice(0, 6), bookings_and_appointments: digest.bookings_and_appointments.slice(0, 6) },
    unread_alerts: alerts.alerts.slice(0, 10),
    observations: insights.insights,
    sources: { connections: sources.connections, stored: sources.stored, transactions_cover: sources.transactions_cover },
    includes_demo_data: sources.stored.demo_transactions > 0 || subs.items.some((s) => s.is_demo) || digest.includes_demo_data,
    empty: sources.empty,
  };
}
