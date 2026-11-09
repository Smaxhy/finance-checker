import Link from "next/link";
import {
  ArrowRight,
  CalendarRange,
  CircleDollarSign,
  CreditCard,
  Inbox,
  Landmark,
  Lightbulb,
  Mail,
  Repeat,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { categoryMap, getProfile, hasAnyData, must } from "@/lib/data/core";
import { densify, lastNMonthsRange, listAccounts, listTransactions, monthSummary, spendingByCategory, spendingByPeriod } from "@/lib/data/finance";
import { getUpcoming, sumExpected } from "@/lib/engines/upcoming";
import { loadInsights } from "@/lib/engines/insights-loader";
import { monthlyEquivalent } from "@/lib/finance/recurring";
import { addDays, addMonths, daysInMonth, monthRange, startOfMonth, startOfWeek, toISODate } from "@/lib/dates";
import { formatDate, formatMoney, formatMonth, relativeTime } from "@/lib/format";
import type { EmailRecord, Subscription } from "@/lib/types";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, StatTile } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { CumulativeCompareChart, SpendingTrend, Sparkline } from "@/components/charts/charts";
import { CategoryBars } from "@/components/finance/category-bars";
import { EmailMiniList, TransactionMiniList, UpcomingList } from "@/components/lists/lists";
import { InsightList } from "@/components/insights/insight-list";
import { OnboardingPanel } from "./onboarding-panel";
import { pctChange } from "@/lib/utils";

export const metadata = { title: "Overview" };

function greeting(d: Date) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function OverviewPage() {
  const { supabase, user } = await requireUser();
  const today = new Date();
  const profile = await getProfile();
  const currency = profile?.base_currency ?? "EUR";

  if (!(await hasAnyData(supabase))) {
    return (
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">
          {greeting(today)}
          {profile?.display_name ? `, ${profile.display_name}` : ""}
        </h1>
        <p className="mt-1 text-[13px] text-muted">{formatDate(today, "long")}</p>
        <OnboardingPanel />
      </div>
    );
  }

  const month = monthRange(today);
  const prevMonth = monthRange(addMonths(startOfMonth(today), -1));
  const weeksFrom = toISODate(startOfWeek(addDays(today, -7 * 11)));
  const year = lastNMonthsRange(12, today);

  const [summary, dailyNow, dailyPrev, weekly, monthly, categories, catSpend, accounts, upcoming, recent, subsRes, emailsRes, insights] =
    await Promise.all([
      monthSummary(supabase, today),
      spendingByPeriod(supabase, month.from, toISODate(today), "day"),
      spendingByPeriod(supabase, prevMonth.from, prevMonth.to, "day"),
      spendingByPeriod(supabase, weeksFrom, toISODate(today), "week"),
      spendingByPeriod(supabase, year.from, year.to, "month"),
      categoryMap(),
      spendingByCategory(supabase, month.from, month.to),
      listAccounts(supabase),
      getUpcoming(supabase, user.id, { days: 14 }),
      listTransactions(supabase, { limit: 7 }),
      supabase.from("subscriptions").select("*").eq("dismissed", false).order("created_at", { ascending: false }),
      supabase
        .from("emails")
        .select("*")
        .or("is_important.eq.true,category.in.(bill,appointment,booking,travel,trial)")
        .gte("received_at", addDays(today, -21).toISOString())
        .order("received_at", { ascending: false })
        .limit(6),
      loadInsights(supabase, user.id, today),
    ]);

  const subs = (must(subsRes, "subscriptions") as Subscription[]).map((s) => ({ ...s, amount: s.amount === null ? null : Number(s.amount) }));
  const activeSubs = subs.filter((s) => s.status === "active" || s.status === "trial" || s.status === "cancellation_pending");
  const recurringMonthly = activeSubs.reduce((a, s) => a + monthlyEquivalent(s.amount, s.billing_cycle), 0);
  const nowMs = today.getTime();
  const newlyDetected = subs.filter((s) => !s.user_confirmed && s.detection_source !== "manual" && nowMs - Date.parse(s.created_at) < 21 * 86_400_000).slice(0, 4);
  const emails = must(emailsRes, "emails") as EmailRecord[];

  const dailySeries = densify(dailyNow, month.from, toISODate(today), "day");
  const weeklySeries = densify(weekly, weeksFrom, toISODate(today), "week");
  const monthlySeries = densify(monthly, year.from, toISODate(today), "month");

  // Last 7 days vs the 7 days before (rolling windows are stable early in the week).
  const last14 = densify(await spendingByPeriod(supabase, toISODate(addDays(today, -13)), toISODate(today), "day"), toISODate(addDays(today, -13)), toISODate(today), "day");
  const thisWeek = last14.slice(7).reduce((a, p) => a + p.spent, 0);
  const prevWeek = last14.slice(0, 7).reduce((a, p) => a + p.spent, 0);

  // Cumulative pace: this month vs last month.
  const prevDense = densify(dailyPrev, prevMonth.from, prevMonth.to, "day");
  const maxDay = Math.max(daysInMonth(today), prevDense.length);
  const cumulative: { day: number; current?: number; previous?: number }[] = [];
  for (let i = 0, accNow = 0, accPrev = 0; i < maxDay; i++) {
    const now = dailySeries[i];
    const prev = prevDense[i];
    if (prev) accPrev += prev.spent;
    if (now) accNow += now.spent;
    cumulative.push({ day: i + 1, current: now ? Math.round(accNow * 100) / 100 : undefined, previous: prev ? Math.round(accPrev * 100) / 100 : undefined });
  }

  const balanceAccounts = accounts.filter((a) => a.include_in_totals && a.balance !== null);
  const balance = balanceAccounts.reduce((a, acc) => a + (acc.balance ?? 0), 0);
  const balanceDemo = balanceAccounts.some((a) => a.is_demo);
  const lastBalanceUpdate = balanceAccounts.map((a) => a.balance_updated_at).filter(Boolean).sort().pop();
  const expectedNext14 = sumExpected(upcoming);

  const monthlyTotals = monthlySeries.map((m) => m.spent);
  const avgMonthly = monthlyTotals.slice(0, -1).filter((v) => v > 0);
  const avgMonthlySpend = avgMonthly.length ? avgMonthly.reduce((a, b) => a + b, 0) / avgMonthly.length : 0;

  const catItems = catSpend.map((c) => {
    const cat = categories.get(c.category_id);
    return { id: c.category_id, name: cat?.name ?? c.category_id, icon: cat?.icon ?? "tag", spent: c.spent, txCount: c.tx_count };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] sm:text-[22px]">
            {greeting(today)}
            {profile?.display_name ? `, ${profile.display_name}` : ""}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {formatDate(today, "long")} · {upcoming.length} thing{upcoming.length === 1 ? "" : "s"} coming up in the next two weeks
            {expectedNext14 > 0 ? `, ${formatMoney(expectedNext14, currency)} in expected payments` : ""}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
          <ButtonLink href="/insights/assistant" variant="secondary">
            <Lightbulb /> Ask a question
          </ButtonLink>
          <ButtonLink href="/finances/transactions?new=1" variant="primary">
            Add transaction
          </ButtonLink>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-5" aria-label="Key figures">
        <StatTile
          className="col-span-2 sm:col-span-1"
          label={`Spent in ${formatMonth(today, "short")}`}
          icon={TrendingDown}
          value={formatMoney(summary.spent, currency)}
          delta={summary.prevSpentToDate >= 25 ? pctChange(summary.spent, summary.prevSpentToDate) : null}
          deltaLabel="vs same days last month"
        >
          <div className="mt-3">
            <Sparkline values={dailySeries.map((d) => d.spent)} />
          </div>
        </StatTile>
        <StatTile
          label="Income this month"
          icon={TrendingUp}
          value={formatMoney(summary.income, currency)}
          delta={summary.prevIncomeToDate > 0 ? pctChange(summary.income, summary.prevIncomeToDate) : null}
          upIsGood
          deltaLabel={summary.prevIncomeToDate > 0 ? "vs same days last month" : `Last month: ${formatMoney(summary.prevIncomeFull, currency)}`}
        >
          <div className="mt-3">
            <Sparkline values={monthlySeries.map((m) => m.income)} color="var(--chart-income)" />
          </div>
        </StatTile>
        <StatTile
          label="Available balance"
          icon={Landmark}
          value={balanceAccounts.length ? formatMoney(balance, currency) : <span className="text-[15px] font-medium text-muted">Not connected</span>}
          hint={
            balanceAccounts.length ? (
              <span className="flex items-center gap-1.5">
                {balanceAccounts.length} account{balanceAccounts.length === 1 ? "" : "s"} · updated {relativeTime(lastBalanceUpdate)} {balanceDemo && <DemoBadge />}
              </span>
            ) : (
              <Link href="/settings/accounts" className="text-accent-text hover:underline">
                Connect a bank to see balances
              </Link>
            )
          }
        />
        <StatTile
          label="Recurring per month"
          icon={Repeat}
          value={formatMoney(recurringMonthly, currency)}
          hint={`${activeSubs.length} subscriptions & bills · ${formatMoney(recurringMonthly * 12, currency, { decimals: 0 })}/yr`}
        />
        <StatTile
          label="Last 7 days"
          icon={Wallet}
          value={formatMoney(thisWeek, currency)}
          delta={prevWeek >= 25 ? pctChange(thisWeek, prevWeek) : null}
          deltaLabel={prevWeek >= 25 ? "vs previous 7 days" : `${formatMoney(prevWeek, currency)} the week before`}
        >
          <div className="mt-3">
            <Sparkline values={last14.map((d) => d.spent)} />
          </div>
        </StatTile>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Spending"
            description={avgMonthlySpend > 0 ? `Average month: ${formatMoney(avgMonthlySpend, currency, { decimals: 0 })} · transfers between your accounts excluded` : "Transfers between your accounts are excluded"}
            action={
              <ButtonLink href="/finances/analytics" variant="ghost" size="sm">
                Analytics <ArrowRight />
              </ButtonLink>
            }
          />
          <CardBody>
            <SpendingTrend
              currency={currency}
              datasets={[
                {
                  key: "daily",
                  label: "Daily",
                  caption: `${formatMonth(today)} so far`,
                  data: dailySeries.map((d) => ({ label: String(Number(d.period.slice(8, 10))), tooltipLabel: formatDate(d.period, "medium"), value: d.spent })),
                },
                {
                  key: "weekly",
                  label: "Weekly",
                  caption: "Last 12 weeks",
                  data: weeklySeries.map((d) => ({ label: formatDate(d.period, "short"), tooltipLabel: `Week of ${formatDate(d.period, "medium")}`, value: d.spent })),
                },
                {
                  key: "monthly",
                  label: "Monthly",
                  caption: "Last 12 months",
                  data: monthlySeries.map((d) => ({ label: formatMonth(d.period, "short"), tooltipLabel: formatMonth(d.period), value: d.spent })),
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Insights"
            description="Computed from your data"
            action={
              <ButtonLink href="/insights/patterns" variant="ghost" size="sm">
                All <ArrowRight />
              </ButtonLink>
            }
          />
          <CardBody>
            {insights.length ? (
              <InsightList insights={insights.slice(0, 5)} compact />
            ) : (
              <EmptyState icon={Lightbulb} title="No insights yet" description="Insights appear once there's at least a few weeks of activity." className="py-6" />
            )}
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader
            title="Upcoming"
            description="Next 14 days"
            action={
              <ButtonLink href="/calendar/upcoming" variant="ghost" size="sm">
                Timeline <ArrowRight />
              </ButtonLink>
            }
          />
          <CardBody>
            {upcoming.length ? (
              <UpcomingList items={upcoming.slice(0, 7)} currency={currency} />
            ) : (
              <EmptyState icon={CalendarRange} title="Nothing scheduled" description="Payments, renewals, trials and events will show here." className="py-6" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Where your money went"
            description={formatMonth(today)}
            action={
              <ButtonLink href="/finances/analytics" variant="ghost" size="sm">
                Details <ArrowRight />
              </ButtonLink>
            }
          />
          <CardBody>
            {catItems.length ? (
              <CategoryBars items={catItems} currency={currency} limit={7} hrefFor={(id) => `/finances/transactions?category=${id}&from=${month.from}&to=${month.to}`} />
            ) : (
              <EmptyState icon={CircleDollarSign} title="No spending this month yet" className="py-6" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent transactions"
            action={
              <ButtonLink href="/finances/transactions" variant="ghost" size="sm">
                All <ArrowRight />
              </ButtonLink>
            }
          />
          <CardBody>
            {recent.rows.length ? (
              <TransactionMiniList rows={recent.rows} categories={categories} />
            ) : (
              <EmptyState icon={CreditCard} title="No transactions" description="Connect a bank or import a CSV export." className="py-6" />
            )}
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader title="Spending pace" description="Cumulative, this month vs last month" />
          <CardBody>
            <CumulativeCompareChart data={cumulative} currency={currency} height={190} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Newly detected subscriptions"
            description="Found in bank transactions and emails"
            action={
              <ButtonLink href="/subscriptions" variant="ghost" size="sm">
                Review <ArrowRight />
              </ButtonLink>
            }
          />
          <CardBody>
            {newlyDetected.length ? (
              <ul className="divide-y divide-border">
                {newlyDetected.map((s) => (
                  <li key={s.id}>
                    <Link href={`/subscriptions/${s.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2">
                      <span className="flex size-7 items-center justify-center rounded-lg border border-border bg-surface-2 text-secondary">
                        <Repeat className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                          {s.name} {s.is_demo && <DemoBadge />}
                        </p>
                        <p className="text-[12px] text-muted">
                          {s.billing_cycle} · via {s.detection_source === "bank" ? "bank transactions" : s.detection_source === "email" ? "email" : "sample data"}
                          {s.next_payment_date ? ` · next ${formatDate(s.next_payment_date, "short")}` : ""}
                        </p>
                      </div>
                      <span className="tabular text-[13px] font-medium">{formatMoney(s.amount, s.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Repeat} title="Nothing new" description="New recurring payments will be flagged here for review." className="py-6" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Important emails"
            description="Bills, bookings, trials and appointments"
            action={
              <ButtonLink href="/emails/important" variant="ghost" size="sm">
                Inbox <ArrowRight />
              </ButtonLink>
            }
          />
          <CardBody>
            {emails.length ? (
              <EmailMiniList rows={emails} />
            ) : (
              <EmptyState
                icon={Inbox}
                title="No important emails"
                description={
                  <>
                    <Link href="/settings/accounts" className="text-accent-text hover:underline">
                      Connect Gmail
                    </Link>{" "}
                    to extract receipts, bills and bookings automatically.
                  </>
                }
                className="py-6"
              />
            )}
            {emails.length > 0 && (
              <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted">
                <Mail className="size-3" /> Read-only access · nothing is ever sent, deleted or modified
                <Badge tone="outline" className="ml-auto">
                  {emails.length}
                </Badge>
              </div>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
