import Link from "next/link";
import { CircleDollarSign, PiggyBank, TrendingUp, Undo2, Wallet } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { categoryMap, getProfile, must } from "@/lib/data/core";
import { densify, lastNMonthsRange, monthSummary, spendingByPeriod, trimLeadingEmpty } from "@/lib/data/finance";
import { toISODate } from "@/lib/dates";
import { formatDate, formatMoney, formatMonth, formatPercent } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import { groupBy, pctChange } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, StatTile } from "@/components/ui/misc";
import { DemoBadge } from "@/components/ui/badge";
import { SpendBarChart } from "@/components/charts/charts";
import { TransactionMiniList } from "@/components/lists/lists";

export const metadata = { title: "Income" };

export default async function IncomePage() {
  const { supabase } = await requireUser();
  const today = new Date();
  const year = lastNMonthsRange(12, today);
  const profile = await getProfile();
  const currency = profile?.base_currency ?? "EUR";

  const [categories, summary, monthly, incomeRes, refundRes] = await Promise.all([
    categoryMap(),
    monthSummary(supabase, today),
    spendingByPeriod(supabase, year.from, year.to, "month"),
    supabase.from("transactions").select("*").eq("kind", "income").gte("booked_at", year.from).order("booked_at", { ascending: false }).limit(2000),
    supabase.from("transactions").select("*").eq("kind", "refund").gte("booked_at", year.from).order("booked_at", { ascending: false }).limit(500),
  ]);
  const income = (must(incomeRes, "income") as Transaction[]).map((t) => ({ ...t, amount: Number(t.amount) }));
  const refunds = (must(refundRes, "refunds") as Transaction[]).map((t) => ({ ...t, amount: Number(t.amount) }));
  const months = trimLeadingEmpty(densify(monthly, year.from, toISODate(today), "month"));
  const totalIncome = months.reduce((a, m) => a + m.income, 0);
  const totalSpent = months.reduce((a, m) => a + m.spent, 0);
  const complete = months.slice(0, -1).filter((m) => m.income > 0);
  const avgMonthly = complete.length ? complete.reduce((a, m) => a + m.income, 0) / complete.length : 0;
  const savingsRate = totalIncome > 0 ? (totalIncome - totalSpent) / totalIncome : null;

  const sources = [...groupBy(income, (t) => t.merchant_key ?? t.counterparty_name ?? "unknown").entries()]
    .map(([key, list]) => ({
      key,
      name: list[0].counterparty_name ?? list[0].merchant ?? "Unknown",
      total: list.reduce((a, t) => a + t.amount, 0),
      count: list.length,
      last: list[0].booked_at,
      category: categories.get(list[0].category_id ?? "other_income")?.name ?? "Income",
      isDemo: list.some((t) => t.is_demo),
    }))
    .sort((a, b) => b.total - a.total);
  const refundTotal = refunds.reduce((a, t) => a + t.amount, 0);

  if (income.length === 0 && refunds.length === 0) {
    return (
      <div>
        <PageHeader title="Income" />
        <Card>
          <EmptyState icon={Wallet} title="No income recorded yet" description="Salary, benefits and other money coming in will appear here once a bank or CSV import is connected." />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Income" description="Money coming in over the last 12 months. Transfers from your own accounts are not counted as income; refunds are tracked separately because they reduce spending." />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="This month"
          icon={TrendingUp}
          value={formatMoney(summary.income, currency)}
          delta={summary.prevIncomeToDate > 0 ? pctChange(summary.income, summary.prevIncomeToDate) : null}
          upIsGood
          deltaLabel={summary.prevIncomeToDate > 0 ? "vs same days last month" : `Last month ${formatMoney(summary.prevIncomeFull, currency)}`}
        />
        <StatTile label="Average month" icon={CircleDollarSign} value={formatMoney(avgMonthly, currency, { decimals: 0 })} hint={`${complete.length} complete months`} />
        <StatTile label="Last 12 months" icon={Wallet} value={formatMoney(totalIncome, currency, { decimals: 0 })} hint={`${income.length} payments`} />
        <StatTile label="Kept (12 months)" icon={PiggyBank} value={savingsRate === null ? "—" : formatPercent(savingsRate, 0, false)} hint={`${formatMoney(totalIncome - totalSpent, currency, { decimals: 0 })} not spent`} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Monthly income" description={`Last ${months.length} months`} />
          <CardBody>
            <SpendBarChart name="Income" color="var(--chart-income)" currency={currency} data={months.map((m) => ({ label: formatMonth(m.period, "short"), tooltipLabel: formatMonth(m.period), value: m.income }))} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Income sources" description="Last 12 months" />
          <CardBody className="px-3">
            <ul>
              {sources.slice(0, 10).map((s) => (
                <li key={s.key}>
                  <Link href={`/finances/transactions?kind=income&q=${encodeURIComponent(s.name)}&period=12m`} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                        {s.name} {s.isDemo && <DemoBadge />}
                      </p>
                      <p className="text-[12px] text-muted">
                        {s.category} · {s.count}× · last {formatDate(s.last, "short")}
                      </p>
                    </div>
                    <span className="text-[13px] font-medium tabular">{formatMoney(s.total, currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent income" />
          <CardBody>
            <TransactionMiniList rows={income.slice(0, 10)} categories={categories} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Refunds & reimbursements" description={`${formatMoney(refundTotal, currency)} over 12 months - netted against spending`} />
          <CardBody>
            {refunds.length ? <TransactionMiniList rows={refunds.slice(0, 10)} categories={categories} /> : <EmptyState icon={Undo2} title="No refunds" className="py-6" />}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
