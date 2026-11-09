import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Subscription } from "@/lib/types";
import { addDays, addMonths, daysInMonth, endOfMonth, monthRange, previousMonthToDate, startOfMonth, toISODate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { getCategories, getProfile, must } from "@/lib/data/core";
import { monthSummary, spendingByCategory } from "@/lib/data/finance";
import { buildInsights, type Insight } from "./insights";
import { getUpcoming } from "./upcoming";

export async function loadInsights(supabase: AppSupabaseClient, userId: string, today = new Date()): Promise<Insight[]> {
  const profile = await getProfile();
  const cur = monthRange(today);
  const prevMtd = previousMonthToDate(today);
  const avgFrom = toISODate(addMonths(startOfMonth(today), -3));
  const avgTo = toISODate(endOfMonth(addMonths(startOfMonth(today), -1)));

  const [categories, summary, nowCats, prevCats, avgCats, subsRes, subTx, biggest, upcoming] = await Promise.all([
    getCategories(),
    monthSummary(supabase, today),
    spendingByCategory(supabase, cur.from, cur.to),
    spendingByCategory(supabase, prevMtd.from, prevMtd.to),
    spendingByCategory(supabase, avgFrom, avgTo),
    supabase.from("subscriptions").select("*").eq("dismissed", false),
    supabase.from("transactions").select("amount").eq("category_id", "subscriptions").gte("booked_at", cur.from).lte("booked_at", cur.to).lt("amount", 0),
    supabase
      .from("transactions")
      .select("merchant, amount, booked_at")
      .in("kind", ["expense"])
      .gte("booked_at", cur.from)
      .lte("booked_at", cur.to)
      .neq("category_id", "housing")
      .order("amount", { ascending: true })
      .limit(1),
    getUpcoming(supabase, userId, { days: 7, from: today }),
  ]);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const subs = (must(subsRes, "subscriptions") as Subscription[]).map((s) => ({
    ...s,
    amount: s.amount === null ? null : Number(s.amount),
    previous_amount: s.previous_amount === null ? null : Number(s.previous_amount),
  }));
  const big = (must(biggest, "biggest purchase") as { merchant: string | null; amount: number; booked_at: string }[])[0];
  const inAWeek = toISODate(addDays(today, 7));

  return buildInsights({
    currency: profile?.base_currency ?? "EUR",
    dayOfMonth: today.getDate(),
    daysInMonth: daysInMonth(today),
    monthSpent: summary.spent,
    prevMonthSpentToDate: summary.prevSpentToDate,
    monthIncome: summary.income,
    categoriesNow: nowCats.map((c) => ({ id: c.category_id, name: names.get(c.category_id) ?? c.category_id, spent: c.spent })),
    categoriesPrevToDate: prevCats.map((c) => ({ id: c.category_id, spent: c.spent })),
    categoriesAvg3m: avgCats.map((c) => ({ id: c.category_id, spent: c.spent / 3 })),
    subscriptions: subs,
    subscriptionChargesThisMonth: (must(subTx, "subscription charges") as { amount: number }[]).reduce((a, t) => a - Number(t.amount), 0),
    upcomingPaymentsThisWeek: upcoming
      .filter((u) => (u.kind === "subscription" || u.kind === "bill" || u.kind === "payment_due") && u.date.slice(0, 10) <= inAWeek)
      .map((u) => ({ title: u.title, amount: u.amount ?? null })),
    biggestPurchase: big ? { merchant: big.merchant ?? "Unknown", amount: -Number(big.amount), date: formatDate(big.booked_at, "short") } : null,
    trialsEndingSoon: subs
      .filter((s) => s.status === "trial" && s.trial_ends_at && s.trial_ends_at <= inAWeek && s.trial_ends_at >= toISODate(today))
      .map((s) => ({ name: s.name, date: formatDate(s.trial_ends_at, "short") })),
  });
}
