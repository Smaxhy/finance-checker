import Link from "next/link";
import { BarChart3, Lightbulb } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCategories, getProfile, must } from "@/lib/data/core";
import { densify, spendingByCategory, spendingByMerchant, spendingByPeriod } from "@/lib/data/finance";
import { loadInsights } from "@/lib/engines/insights-loader";
import { VARIABLE_CATEGORIES } from "@/lib/engines/insights";
import { addDays, addMonths, endOfMonth, monthRange, previousMonthToDate, startOfMonth, toISODate } from "@/lib/dates";
import { formatMoney, formatMonth, formatPercent } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { InsightList } from "@/components/insights/insight-list";
import { IncomeExpenseChart, SpendBarChart } from "@/components/charts/charts";
import { TwoSeriesBars } from "@/components/insights/two-series-bars";
import { CategoryIcon } from "@/components/category-icon";
import { monthKeys, savingsRate, splitRecurringByMonth, weekdayAverages, type SpendRow } from "../_lib/report";
import { cn } from "@/lib/utils";

export const metadata = { title: "Spending Patterns" };

export default async function PatternsPage() {
  const { supabase, user } = await requireUser();
  const today = new Date();
  const profile = await getProfile();
  const currency = profile?.base_currency ?? "EUR";

  const dayFrom = toISODate(addDays(today, -90));
  const dayTo = toISODate(today);
  const sixFrom = toISODate(startOfMonth(addMonths(today, -5)));
  const cur = monthRange(today);
  const prevMtd = previousMonthToDate(today);
  const lastMonth = monthRange(addMonths(startOfMonth(today), -1));
  const avgFrom = toISODate(addMonths(startOfMonth(today), -3));
  const avgTo = toISODate(endOfMonth(addMonths(startOfMonth(today), -1)));
  const months = monthKeys(toISODate(today).slice(0, 7), 6);

  const [insights, categories, daily, merchants, monthly, spendRowsRes, catNow, catPrev, catLast, catAvg] = await Promise.all([
    loadInsights(supabase, user.id, today),
    getCategories(),
    spendingByPeriod(supabase, dayFrom, dayTo, "day"),
    spendingByMerchant(supabase, dayFrom, dayTo, 60),
    spendingByPeriod(supabase, sixFrom, cur.to, "month"),
    supabase
      .from("transactions")
      .select("booked_at, amount, kind, category_id, subscription_id")
      .eq("user_id", user.id)
      .gte("booked_at", sixFrom)
      .lte("booked_at", cur.to)
      .in("kind", ["expense", "withdrawal", "fee", "refund"])
      .limit(10000),
    spendingByCategory(supabase, cur.from, toISODate(today)),
    spendingByCategory(supabase, prevMtd.from, prevMtd.to),
    spendingByCategory(supabase, lastMonth.from, lastMonth.to),
    spendingByCategory(supabase, avgFrom, avgTo),
  ]);

  const names = new Map(categories.map((c) => [c.id, c]));
  const hasData = daily.length > 0 || monthly.length > 0;

  const weekdays = weekdayAverages(densify(daily, dayFrom, dayTo, "day"));
  const busiest = [...weekdays].sort((a, b) => b.average - a.average)[0];

  const split = splitRecurringByMonth(must(spendRowsRes, "transactions") as SpendRow[], months);
  const splitTotals = split.reduce((a, m) => ({ recurring: a.recurring + m.recurring, variable: a.variable + m.variable }), { recurring: 0, variable: 0 });
  const recurringShare = splitTotals.recurring + splitTotals.variable > 0 ? splitTotals.recurring / (splitTotals.recurring + splitTotals.variable) : 0;

  const monthlyDense = densify(monthly, sixFrom, cur.to, "month");
  const byAmount = merchants.slice(0, 8);
  const byFrequency = [...merchants].sort((a, b) => b.tx_count - a.tx_count || b.spent - a.spent).slice(0, 8);

  const mapOf = (rows: { category_id: string; spent: number }[]) => new Map(rows.map((r) => [r.category_id, r.spent]));
  const now = mapOf(catNow);
  const prev = mapOf(catPrev);
  const last = mapOf(catLast);
  const avg = mapOf(catAvg);
  const catIds = [...new Set([...now.keys(), ...prev.keys(), ...last.keys(), ...avg.keys()])];
  const catRows = catIds
    .map((id) => ({
      id,
      name: names.get(id)?.name ?? id,
      icon: names.get(id)?.icon ?? "tag",
      now: now.get(id) ?? 0,
      prev: prev.get(id) ?? 0,
      last: last.get(id) ?? 0,
      avg: (avg.get(id) ?? 0) / 3,
      variable: VARIABLE_CATEGORIES.has(id),
    }))
    .sort((a, b) => b.now - a.now || b.last - a.last);

  if (!hasData) {
    return (
      <div>
        <PageHeader title="Spending Patterns" description="Patterns computed directly from your transactions." />
        <Card>
          <EmptyState
            icon={BarChart3}
            title="No transactions yet"
            description={
              <>
                Connect a bank or import a CSV export in{" "}
                <Link href="/settings/accounts" className="text-accent-text hover:underline">
                  Connected Accounts
                </Link>{" "}
                to see your patterns.
              </>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Spending Patterns" description="Computed directly from your stored transactions - no estimates. Transfers between your own accounts are excluded." />

      <section>
        <h2 className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-secondary">
          <Lightbulb className="size-3.5" /> Observations
        </h2>
        {insights.length ? <InsightList insights={insights} /> : <Card><EmptyState icon={Lightbulb} title="No observations yet" description="Observations appear once there are a few weeks of activity." /></Card>}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Spending by day of week"
            description={busiest && busiest.average > 0 ? `Average per day over the last 90 days · ${busiest.label} is your biggest spending day (${formatMoney(busiest.average, currency)})` : "Average per day over the last 90 days"}
          />
          <CardBody>
            <SpendBarChart data={weekdays.map((w) => ({ label: w.label, tooltipLabel: `${w.label} - average of ${w.days} days`, value: w.average }))} currency={currency} height={220} name="Average spent" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Recurring vs day-to-day spending"
            description={`Last 6 months · ${Math.round(recurringShare * 100)}% of spending went to subscriptions, rent and bills`}
          />
          <CardBody>
            <TwoSeriesBars
              currency={currency}
              height={220}
              series={[
                { key: "recurring", label: "Recurring (subscriptions, rent, bills)", color: "var(--chart-spend)" },
                { key: "variable", label: "Day-to-day", color: "var(--chart-income)" },
              ]}
              data={split.map((m) => ({ label: formatMonth(`${m.month}-01`, "short"), recurring: m.recurring, variable: m.variable }))}
            />
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Income vs spending" description="Last 6 months · how much of your income you kept" />
          <CardBody>
            <IncomeExpenseChart currency={currency} height={210} data={monthlyDense.map((m) => ({ label: formatMonth(m.period, "short"), income: m.income, spent: m.spent }))} />
            <div className="mt-4 overflow-x-auto">
              <table className="data-table m-hide-c2 text-[12.5px]">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="text-right">Income</th>
                    <th className="text-right">Spent</th>
                    <th className="text-right">Share of income spent</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyDense.map((m) => {
                    const rate = savingsRate(m.income, m.spent);
                    return (
                      <tr key={m.period}>
                        <td>{formatMonth(m.period)}</td>
                        <td className="tabular text-right">{formatMoney(m.income, currency)}</td>
                        <td className="tabular text-right">{formatMoney(m.spent, currency)}</td>
                        <td className={cn("tabular text-right", rate !== null && rate < 0 && "text-danger")}>{rate === null ? "-" : formatPercent(1 - rate, 0, false)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Top merchants & payees" description="Last 90 days, including rent and bills" />
          <CardBody>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <MerchantList title="By amount" rows={byAmount.map((m) => ({ key: m.merchant_key, name: m.merchant, primary: formatMoney(m.spent, currency), secondary: `${m.tx_count}×` }))} />
              <MerchantList title="By frequency" rows={byFrequency.map((m) => ({ key: m.merchant_key, name: m.merchant, primary: `${m.tx_count}×`, secondary: formatMoney(m.spent, currency) }))} />
            </div>
          </CardBody>
        </Card>
      </section>

      <Card>
        <CardHeader title="Category changes" description={`This month so far vs the same ${today.getDate()} days last month, with last month and your 3-month average for context`} />
        <div className="overflow-x-auto px-2 pb-3">
          <table className="data-table m-hide-c3 m-hide-c5 m-hide-c6 t-hide-c5 t-hide-c6 text-[13px]">
            <thead>
              <tr>
                <th>Category</th>
                <th className="text-right">This month</th>
                <th className="text-right">Same days last month</th>
                <th className="text-right">Change</th>
                <th className="text-right">Last month (full)</th>
                <th className="text-right">3-month average</th>
              </tr>
            </thead>
            <tbody>
              {catRows.map((c) => {
                const change = c.prev > 0 ? (c.now - c.prev) / c.prev : null;
                const changeLabel = change !== null ? formatPercent(change) : c.now > 0 ? "new" : "-";
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/finances/transactions?category=${c.id}`} className="flex items-center gap-2.5 hover:text-accent-text">
                        <CategoryIcon icon={c.icon} />
                        <span>{c.name}</span>
                        {!c.variable && <span className="rounded bg-surface-3 px-1 text-[10.5px] text-muted">fixed</span>}
                      </Link>
                    </td>
                    <td className="tabular text-right font-medium">{formatMoney(c.now, currency)}</td>
                    <td className="tabular text-right text-secondary">{formatMoney(c.prev, currency)}</td>
                    <td className={cn("tabular text-right", change === null ? "text-muted" : change > 0.1 ? "text-danger" : change < -0.1 ? "text-positive" : "text-secondary")}>
                      {changeLabel}
                    </td>
                    <td className="tabular text-right text-secondary">{formatMoney(c.last, currency)}</td>
                    <td className="tabular text-right text-secondary">{formatMoney(c.avg, currency)}</td>
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

function MerchantList({ title, rows }: { title: string; rows: { key: string; name: string; primary: string; secondary: string }[] }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-medium text-muted">{title}</p>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">No purchases.</p>
      ) : (
        <ol className="space-y-0.5">
          {rows.map((r, i) => (
            <li key={r.key}>
              <Link href={`/finances/transactions?q=${encodeURIComponent(r.name)}`} className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-surface-2">
                <span className="w-4 text-right text-[11.5px] text-muted tabular">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="tabular font-medium">{r.primary}</span>
                <span className="w-16 text-right text-[11.5px] text-muted tabular">{r.secondary}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
