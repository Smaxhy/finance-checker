import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Account, Budget, CategorySpend, MerchantSpend, PeriodPoint, Transaction, TransactionKind } from "@/lib/types";
import { addDays, monthRange, previousMonthToDate, startOfMonth, startOfWeek, toISODate, addMonths, endOfMonth, parseISODate } from "@/lib/dates";
import { must } from "./core";

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function mapTx(row: Record<string, unknown>): Transaction {
  return { ...(row as unknown as Transaction), amount: num(row.amount) };
}

export interface TransactionFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  kind?: TransactionKind | "spending";
  merchantKey?: string;
  accountId?: string;
  q?: string;
  minAmount?: number;
  limit?: number;
  offset?: number;
  subscriptionId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTxFilters<Q extends { gte: any; lte: any; eq: any; in: any; or: any }>(q: Q, f: TransactionFilters): Q {
  if (f.from) q = q.gte("booked_at", f.from);
  if (f.to) q = q.lte("booked_at", f.to);
  if (f.categoryId) q = q.eq("category_id", f.categoryId);
  if (f.kind === "spending") q = q.in("kind", ["expense", "withdrawal", "fee", "refund"]);
  else if (f.kind) q = q.eq("kind", f.kind);
  if (f.merchantKey) q = q.eq("merchant_key", f.merchantKey);
  if (f.accountId) q = q.eq("account_id", f.accountId);
  if (f.subscriptionId) q = q.eq("subscription_id", f.subscriptionId);
  if (f.minAmount) q = q.or(`amount.gte.${f.minAmount},amount.lte.${-f.minAmount}`);
  if (f.q) {
    // Strip characters that have meaning in PostgREST filter syntax.
    const term = f.q.replace(/[%,()*\\]/g, " ").trim();
    if (term) q = q.or(`description.ilike.%${term}%,merchant.ilike.%${term}%,counterparty_name.ilike.%${term}%,notes.ilike.%${term}%`);
  }
  return q;
}

export async function listTransactions(supabase: AppSupabaseClient, f: TransactionFilters = {}) {
  let q = supabase.from("transactions").select("*", { count: "exact" }).order("booked_at", { ascending: false }).order("created_at", { ascending: false });
  q = applyTxFilters(q, f);
  const limit = Math.min(f.limit ?? 100, 1000);
  q = q.range(f.offset ?? 0, (f.offset ?? 0) + limit - 1);
  const res = await q;
  const rows = must(res, "transactions") as Record<string, unknown>[];
  return { rows: rows.map(mapTx), count: res.count ?? rows.length };
}

/** Money in / out for everything matching the filters (transfers reported separately). */
export async function transactionTotals(supabase: AppSupabaseClient, f: TransactionFilters = {}) {
  const q = applyTxFilters(supabase.from("transactions").select("amount, kind").limit(20000), f);
  const rows = must(await q, "transaction totals") as { amount: number; kind: TransactionKind }[];
  let moneyOut = 0;
  let moneyIn = 0;
  let transfers = 0;
  for (const r of rows) {
    const a = Number(r.amount);
    if (r.kind === "transfer") transfers += Math.abs(a);
    else if (a < 0) moneyOut += -a;
    else moneyIn += a;
  }
  return { moneyOut, moneyIn, transfers, count: rows.length };
}

export async function spendingByPeriod(supabase: AppSupabaseClient, from: string, to: string, grain: "day" | "week" | "month", userId?: string) {
  const rows = must(await supabase.rpc("spending_by_period", { p_from: from, p_to: to, p_grain: grain, ...(userId ? { p_user_id: userId } : {}) }), "spending") as Record<string, unknown>[];
  return rows.map(
    (r): PeriodPoint => ({
      period: String(r.period),
      spent: num(r.spent),
      income: num(r.income),
      refunds: num(r.refunds),
      tx_count: num(r.tx_count),
    }),
  );
}

export async function spendingByCategory(supabase: AppSupabaseClient, from: string, to: string, userId?: string): Promise<CategorySpend[]> {
  const rows = must(await supabase.rpc("spending_by_category", { p_from: from, p_to: to, ...(userId ? { p_user_id: userId } : {}) }), "category spending") as Record<string, unknown>[];
  return rows.map((r) => ({ category_id: String(r.category_id), spent: num(r.spent), tx_count: num(r.tx_count) }));
}

export async function spendingByMerchant(supabase: AppSupabaseClient, from: string, to: string, limit = 20, userId?: string): Promise<MerchantSpend[]> {
  const rows = must(await supabase.rpc("spending_by_merchant", { p_from: from, p_to: to, p_limit: limit, ...(userId ? { p_user_id: userId } : {}) }), "merchant spending") as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({
    merchant: String(r.merchant),
    merchant_key: String(r.merchant_key),
    spent: num(r.spent),
    tx_count: num(r.tx_count),
    last_seen: String(r.last_seen),
  }));
}

/** Fill gaps so charts show every day/week/month in range, including zero days. */
export function densify(points: PeriodPoint[], from: string, to: string, grain: "day" | "week" | "month"): PeriodPoint[] {
  const byKey = new Map(points.map((p) => [p.period.slice(0, 10), p]));
  const out: PeriodPoint[] = [];
  let cursor = grain === "month" ? startOfMonth(parseISODate(from)) : grain === "week" ? startOfWeek(parseISODate(from)) : parseISODate(from);
  const end = parseISODate(to);
  let guard = 0;
  while (cursor <= end && guard++ < 1000) {
    const key = toISODate(cursor);
    out.push(byKey.get(key) ?? { period: key, spent: 0, income: 0, refunds: 0, tx_count: 0 });
    cursor = grain === "month" ? addMonths(cursor, 1) : addDays(cursor, grain === "week" ? 7 : 1);
  }
  return out;
}

/** Drop leading periods with no activity (e.g. before the first import), keeping at least `min`. */
export function trimLeadingEmpty(points: PeriodPoint[], min = 3): PeriodPoint[] {
  const first = points.findIndex((p) => p.spent !== 0 || p.income !== 0);
  if (first <= 0) return points;
  return points.slice(Math.min(first, Math.max(0, points.length - min)));
}

export interface MonthSummary {
  spent: number;
  income: number;
  refunds: number;
  txCount: number;
  prevSpentToDate: number;
  prevIncomeToDate: number;
  prevSpentFull: number;
  prevIncomeFull: number;
}

export async function monthSummary(supabase: AppSupabaseClient, today = new Date()): Promise<MonthSummary> {
  const cur = monthRange(today);
  const prevMtd = previousMonthToDate(today);
  const prevFull = monthRange(addMonths(startOfMonth(today), -1));
  const [current, prev, prevAll] = await Promise.all([
    spendingByPeriod(supabase, cur.from, cur.to, "month"),
    spendingByPeriod(supabase, prevMtd.from, prevMtd.to, "month"),
    spendingByPeriod(supabase, prevFull.from, prevFull.to, "month"),
  ]);
  const total = (ps: PeriodPoint[], k: "spent" | "income" | "refunds" | "tx_count") => ps.reduce((a, p) => a + p[k], 0);
  return {
    spent: total(current, "spent"),
    income: total(current, "income"),
    refunds: total(current, "refunds"),
    txCount: total(current, "tx_count"),
    prevSpentToDate: total(prev, "spent"),
    prevIncomeToDate: total(prev, "income"),
    prevSpentFull: total(prevAll, "spent"),
    prevIncomeFull: total(prevAll, "income"),
  };
}

export async function listAccounts(supabase: AppSupabaseClient): Promise<Account[]> {
  const rows = must(await supabase.from("accounts").select("*").order("created_at"), "accounts") as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as Account), balance: r.balance === null ? null : num(r.balance) }));
}

export async function listBudgets(supabase: AppSupabaseClient): Promise<Budget[]> {
  const rows = must(await supabase.from("budgets").select("*"), "budgets") as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as Budget), amount: num(r.amount) }));
}

export function lastNMonthsRange(n: number, today = new Date()) {
  const start = addMonths(startOfMonth(today), -(n - 1));
  return { from: toISODate(start), to: toISODate(endOfMonth(today)) };
}
