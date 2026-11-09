import Link from "next/link";
import { ArrowRight, BarChart3, CalendarDays, Receipt, Repeat, TrendingDown } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { categoryMap, getProfile, must } from "@/lib/data/core";
import { densify, trimLeadingEmpty, lastNMonthsRange, listTransactions, spendingByCategory, spendingByMerchant, spendingByPeriod } from "@/lib/data/finance";
import { resolvePeriod, str } from "@/lib/finance/periods";
import { monthlyEquivalent } from "@/lib/finance/recurring";
import { addMonths, daysBetween, endOfMonth, monthRange, parseISODate, previousMonthToDate, startOfMonth, toISODate } from "@/lib/dates";
import { formatDate, formatMoney, formatMonth, formatPercent } from "@/lib/format";
import type { Subscription } from "@/lib/types";
import { cn, pctChange } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, StatTile } from "@/components/ui/misc";
import { DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { IncomeExpenseChart, SpendBarChart } from "@/components/charts/charts";
import { CategoryBars } from "@/components/finance/category-bars";
import { CategoryIcon } from "@/components/category-icon";
import { PeriodPicker } from "@/components/finance/period-picker";

export const metadata = { title: "Spending Analytics" };

const OPTIONS = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "12 months" },
  { value: "ytd", label: "Year to date" },
];

export default async function AnalyticsPage({ searchParams }: PageProps<"/finances/analytics">) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const today = new Date();
  const period = resolvePeriod({ period: str(sp.period) }, "this-month", today);
  const from = period.from!;
  const to = period.to!;
  const profile = await getProfile();
  const currency = profile?.base_currency ?? "EUR";
  const year = lastNMonthsRange(12, today);
  const thisMonth = monthRange(today);
  const lastMonth = monthRange(addMonths(startOfMonth(today), -1));
  const avgFrom = toISODate(addMonths(startOfMonth(today), -3));
  const avgTo = toISODate(endOfMonth(addMonths(startOfMonth(today), -1)));

  const prevMtd = previousMonthToDate(today);
  const [categories, byCat, byMerchant, monthly, daily, biggest, catThis, catLast, catAvg, subsRes, catPrevMtd] = await Promise.all([
    categoryMap(),
    spendingByCategory(supabase, from, to),
    spendingByMerchant(supabase, from, to, 15),
    spendingByPeriod(supabase, year.from, year.to, "month"),
    spendingByPeriod(supabase, from, to, "day"),
    listTransactions(supabase, { from, to, kind: "expense", limit: 400 }),
    spendingByCategory(supabase, thisMonth.from, thisMonth.to),
    spendingByCategory(supabase, lastMonth.from, lastMonth.to),
    spendingByCategory(supabase, avgFrom, avgTo),
    supabase.from("subscriptions").select("*").in("status", ["active", "trial", "cancellation_pending"]).eq("dismissed", false),
    spendingByCategory(supabase, prevMtd.from, prevMtd.to),
  ]);

  const totalSpent = byCat.reduce((a, c) => a + c.spent, 0);
  const elapsedDays = Math.max(1, daysBetween(from, to < toISODate(today) ? to : toISODate(today)) + 1);
  const avgDaily = totalSpent / elapsedDays;
  const months12 = trimLeadingEmpty(densify(monthly, year.from, toISODate(today), "month"));
  const fullMonths = months12.slice(0, -1).filter((m) => m.spent > 0 || m.income > 0);
  const avgMonthly = fullMonths.length ? fullMonths.reduce((a, m) => a + m.spent, 0) / fullMonths.length : 0;
  const txCount = byCat.reduce((a, c) => a + c.tx_count, 0);
  const biggestPurchases = [...biggest.rows].sort((a, b) => a.amount - b.amount).slice(0, 8);
  const dailySeries = densify(daily, from, to < toISODate(today) ? to : toISODate(today), "day");
  const subs = (must(subsRes, "subscriptions") as Subscription[]).map((s) => ({ ...s, amount: s.amount === null ? null : Number(s.amount) }));
  const recurring = subs.map((s) => ({ ...s, monthly: monthlyEquivalent(s.amount, s.billing_cycle) })).sort((a, b) => b.monthly - a.monthly).slice(0, 8);
  const recurringTotal = subs.reduce((a, s) => a + monthlyEquivalent(s.amount, s.billing_cycle), 0);

  const lastMap = new Map(catLast.map((c) => [c.category_id, c.spent]));
  const avgMap = new Map(catAvg.map((c) => [c.category_id, c.spent / 3]));
  const prevMtdMap = new Map(catPrevMtd.map((c) => [c.category_id, c.spent]));
  const compareIds = [...new Set([...catThis.map((c) => c.category_id), ...catLast.map((c) => c.category_id)])];
  const comparison = compareIds
    .map((id) => ({ id, now: catThis.find((c) => c.category_id === id)?.spent ?? 0, sameDays: prevMtdMap.get(id) ?? 0, last: lastMap.get(id) ?? 0, avg: avgMap.get(id) ?? 0 }))
    .sort((a, b) => b.now + b.last - (a.now + a.last));

  const yearTable = [...months12].reverse();
  const yearSpent = months12.reduce((a, m) => a + m.spent, 0);
  const yearIncome = months12.reduce((a, m) => a + m.income, 0);

  if (totalSpent === 0 && yearSpent === 0) {
    return (
      <div>
        <PageHeader title="Spending Analytics" />
        <Card>
          <EmptyState icon={BarChart3} title="No spending to analyse yet" description="Connect a bank, import a CSV or load demo data from the Overview page." action={<ButtonLink href="/settings/accounts">Connect accounts</ButtonLink>} />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Spending Analytics"
        description={`${period.label}: ${formatDate(from)} – ${formatDate(to)}. Click any category or merchant to see the transactions behind it.`}
        actions={<PeriodPicker options={OPTIONS} value={period.key} />}
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Total spent" icon={TrendingDown} value={formatMoney(totalSpent, currency)} hint={`${txCount} transactions`} />
        <StatTile label="Average per day" icon={CalendarDays} value={formatMoney(avgDaily, currency)} hint={`over ${elapsedDays} days`} />
        <StatTile label="Average month" icon={BarChart3} value={formatMoney(avgMonthly, currency, { decimals: 0 })} hint={`last ${fullMonths.length} complete months`} />
        <StatTile label="Recurring per month" icon={Repeat} value={formatMoney(recurringTotal, currency)} hint={totalSpent > 0 ? `${subs.length} subscriptions & bills` : undefined} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Spending by category" description="Net of refunds · transfers excluded" />
          <CardBody>
            {byCat.length ? (
              <CategoryBars
                currency={currency}
                items={byCat.map((c) => ({ id: c.category_id, name: categories.get(c.category_id)?.name ?? c.category_id, icon: categories.get(c.category_id)?.icon ?? "tag", spent: c.spent, txCount: c.tx_count }))}
                hrefFor={(id) => `/finances/transactions?category=${id}&from=${from}&to=${to}`}
              />
            ) : (
              <EmptyState title="No spending in this period" className="py-8" />
            )}
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Spending by merchant" description="Top 15" />
          <CardBody className="px-3">
            <ul>
              {byMerchant.map((m, i) => (
                <li key={m.merchant_key}>
                  <Link
                    href={`/finances/transactions?q=${encodeURIComponent(m.merchant)}&from=${from}&to=${to}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-surface-2"
                  >
                    <span className="w-5 text-right text-[11.5px] text-muted tabular">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{m.merchant}</span>
                    <span className="text-[12px] text-muted">{m.tx_count}×</span>
                    <span className="w-24 text-right font-medium tabular">{formatMoney(m.spent, currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Daily spending" description={period.label} />
          <CardBody>
            <SpendBarChart
              currency={currency}
              data={dailySeries.map((d) => ({
                label: dailySeries.length > 45 ? formatDate(d.period, "short") : String(parseISODate(d.period).getDate()),
                tooltipLabel: formatDate(d.period, "long"),
                value: d.spent,
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Income vs spending" description={`Last ${months12.length} months`} />
          <CardBody>
            <IncomeExpenseChart currency={currency} data={months12.map((m) => ({ label: formatMonth(m.period, "short"), income: m.income, spent: m.spent }))} height={218} />
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Month-over-month by category" description={`${formatMonth(today)} so far vs the same ${today.getDate()} days of ${formatMonth(addMonths(today, -1))}; full last month and 3-month average for context`} />
          <div className="overflow-x-auto">
            <table className="data-table m-hide-c3 m-hide-c5 m-hide-c6">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="text-right">So far</th>
                  <th className="text-right">Same days last mo.</th>
                  <th className="text-right">Change</th>
                  <th className="text-right">Last month</th>
                  <th className="text-right">3-mo avg</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((c) => {
                  const change = c.sameDays >= 5 ? pctChange(c.now, c.sameDays) : null;
                  const cat = categories.get(c.id);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/finances/transactions?category=${c.id}&period=this-month`} className="flex items-center gap-2 text-[13px] hover:text-accent-text">
                          <CategoryIcon icon={cat?.icon} className="size-6" /> {cat?.name ?? c.id}
                        </Link>
                      </td>
                      <td className="text-right text-[13px] font-medium tabular">{formatMoney(c.now, currency)}</td>
                      <td className="text-right text-[13px] text-secondary tabular">{formatMoney(c.sameDays, currency)}</td>
                      <td className={cn("text-right text-[12.5px] tabular", change === null ? "text-muted" : change > 0.15 ? "text-warning" : change < -0.15 ? "text-positive" : "text-muted")}>
                        {change === null ? "—" : formatPercent(change)}
                      </td>
                      <td className="text-right text-[13px] text-muted tabular">{formatMoney(c.last, currency)}</td>
                      <td className="text-right text-[13px] text-muted tabular">{formatMoney(c.avg, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Biggest purchases" description={period.label} />
            <CardBody className="px-3">
              {biggestPurchases.length ? (
                <ul>
                  {biggestPurchases.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px]">
                      <CategoryIcon icon={categories.get(t.category_id ?? "other")?.icon} className="size-6" />
                      <span className="min-w-0 flex-1 truncate">
                        {t.merchant} {t.is_demo && <DemoBadge className="ml-1" />}
                      </span>
                      <span className="text-[12px] text-muted">{formatDate(t.booked_at, "short")}</span>
                      <span className="w-24 text-right font-medium tabular">{formatMoney(-t.amount, t.currency)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={Receipt} title="No purchases" className="py-6" />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Biggest recurring expenses"
              description="Monthly equivalent"
              action={
                <ButtonLink href="/subscriptions" variant="ghost" size="sm">
                  All <ArrowRight />
                </ButtonLink>
              }
            />
            <CardBody className="px-3">
              <ul>
                {recurring.map((s) => (
                  <li key={s.id}>
                    <Link href={`/subscriptions/${s.id}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-surface-2">
                      <span className="min-w-0 flex-1 truncate">
                        {s.name} {s.is_demo && <DemoBadge className="ml-1" />}
                      </span>
                      <span className="text-[12px] text-muted">{s.billing_cycle}</span>
                      <span className="w-24 text-right font-medium tabular">{formatMoney(s.monthly, s.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader title="Yearly overview" description={`Last ${months12.length} months · ${formatMoney(yearIncome, currency, { decimals: 0 })} in, ${formatMoney(yearSpent, currency, { decimals: 0 })} out`} />
        <div className="overflow-x-auto">
          <table className="data-table m-hide-c5">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Income</th>
                <th className="text-right">Spending</th>
                <th className="text-right">Net</th>
                <th className="text-right">Kept</th>
              </tr>
            </thead>
            <tbody>
              {yearTable.map((m) => {
                const net = m.income - m.spent;
                return (
                  <tr key={m.period}>
                    <td className="text-[13px]">
                      <Link href={`/finances/transactions?from=${m.period}&to=${toISODate(endOfMonth(parseISODate(m.period)))}`} className="hover:text-accent-text">
                        {formatMonth(m.period)}
                      </Link>
                    </td>
                    <td className="text-right text-[13px] tabular">{formatMoney(m.income, currency)}</td>
                    <td className="text-right text-[13px] tabular">{formatMoney(m.spent, currency)}</td>
                    <td className={cn("text-right text-[13px] font-medium tabular", net >= 0 ? "text-positive" : "text-danger")}>{formatMoney(net, currency, { sign: true })}</td>
                    <td className="text-right text-[12.5px] text-muted tabular">{m.income > 0 ? formatPercent(net / m.income, 0, false) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
