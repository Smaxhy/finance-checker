import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCategories, getProfile, must } from "@/lib/data/core";
import { listTransactions, spendingByCategory, spendingByMerchant, spendingByPeriod } from "@/lib/data/finance";
import { getUpcoming } from "@/lib/engines/upcoming";
import { addMonths, endOfMonth, monthRange, parseMonthParam, startOfMonth, toISODate, daysInMonth } from "@/lib/dates";
import { formatDate, formatMoney, formatMonth, formatPercent } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, StatTile } from "@/components/ui/misc";
import { DemoBadge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/category-icon";
import { ReportActions } from "@/components/insights/report-actions";
import { MonthPicker } from "@/components/insights/month-picker";
import type { Subscription } from "@/lib/types";
import { monthKeys, projectSubscriptionsIntoMonth, savingsRate, shiftMonth } from "../_lib/report";
import { cn } from "@/lib/utils";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/insights/reports">) {
  const { supabase, user } = await requireUser();
  const sp = await searchParams;
  const today = new Date();
  const currentMonth = toISODate(today).slice(0, 7);
  let monthDate = parseMonthParam(typeof sp.month === "string" ? sp.month : null, today);
  if (toISODate(monthDate).slice(0, 7) > currentMonth) monthDate = startOfMonth(today);
  const month = toISODate(monthDate).slice(0, 7);
  const range = monthRange(monthDate);
  const prevRange = monthRange(addMonths(monthDate, -1));
  const isCurrent = month === currentMonth;
  const yearKeys = monthKeys(month, 12);
  const yearFrom = `${yearKeys[0]}-01`;

  const profile = await getProfile();
  const currency = profile?.base_currency ?? "EUR";

  const [categories, totalsNow, totalsPrev, catNow, catPrev, merchants, biggestRes, subTxRes, subsRes, yearly] = await Promise.all([
    getCategories(),
    spendingByPeriod(supabase, range.from, range.to, "month"),
    spendingByPeriod(supabase, prevRange.from, prevRange.to, "month"),
    spendingByCategory(supabase, range.from, range.to),
    spendingByCategory(supabase, prevRange.from, prevRange.to),
    spendingByMerchant(supabase, range.from, range.to, 10),
    listTransactions(supabase, { from: range.from, to: range.to, kind: "expense", limit: 1000 }),
    supabase
      .from("transactions")
      .select("amount, booked_at, subscription_id, is_demo")
      .eq("user_id", user.id)
      .not("subscription_id", "is", null)
      .lt("amount", 0)
      .gte("booked_at", range.from)
      .lte("booked_at", range.to),
    supabase.from("subscriptions").select("*").eq("user_id", user.id).eq("dismissed", false),
    spendingByPeriod(supabase, yearFrom, range.to, "month"),
  ]);

  const names = new Map(categories.map((c) => [c.id, c]));
  const sumOf = (rows: { spent: number; income: number; refunds: number; tx_count: number }[]) =>
    rows.reduce((a, r) => ({ spent: a.spent + r.spent, income: a.income + r.income, tx: a.tx + r.tx_count }), { spent: 0, income: 0, tx: 0 });
  const now = sumOf(totalsNow);
  const prev = sumOf(totalsPrev);
  const net = now.income - now.spent;
  const rate = savingsRate(now.income, now.spent);
  const prevRate = savingsRate(prev.income, prev.spent);

  const prevCat = new Map(catPrev.map((c) => [c.category_id, c.spent]));
  const catIds = [...new Set([...catNow.map((c) => c.category_id), ...catPrev.map((c) => c.category_id)])];
  const catRows = catIds
    .map((id) => ({ id, name: names.get(id)?.name ?? id, icon: names.get(id)?.icon ?? "tag", now: catNow.find((c) => c.category_id === id)?.spent ?? 0, prev: prevCat.get(id) ?? 0 }))
    .sort((a, b) => b.now - a.now || b.prev - a.prev);

  // Purchases only: rent, utilities and subscriptions are listed separately.
  const biggest = [...biggestRes.rows]
    .filter((t) => !["housing", "bills", "subscriptions"].includes(t.category_id ?? "") && !t.subscription_id)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 10);

  const subs = (must(subsRes, "subscriptions") as Subscription[]).map((s) => ({ ...s, amount: s.amount === null ? null : Number(s.amount) }));
  const subById = new Map(subs.map((s) => [s.id, s]));
  const paidMap = new Map<string, { name: string; total: number; count: number; isDemo: boolean; id: string }>();
  for (const t of must(subTxRes, "subscription charges") as { amount: number; subscription_id: string; is_demo: boolean }[]) {
    const s = subById.get(t.subscription_id);
    const entry = paidMap.get(t.subscription_id) ?? { id: t.subscription_id, name: s?.name ?? "Subscription", total: 0, count: 0, isDemo: t.is_demo };
    entry.total += -Number(t.amount);
    entry.count += 1;
    paidMap.set(t.subscription_id, entry);
  }
  const paid = [...paidMap.values()].sort((a, b) => b.total - a.total);
  const paidTotal = paid.reduce((a, p) => a + p.total, 0);

  // Expected next month (only meaningful for the current month's report).
  const nextStart = startOfMonth(addMonths(monthDate, 1));
  const nextEnd = endOfMonth(nextStart);
  const expectedSubs = isCurrent ? projectSubscriptionsIntoMonth(subs, toISODate(nextStart), toISODate(nextEnd)) : [];
  const nextItems = isCurrent
    ? (await getUpcoming(supabase, user.id, { from: nextStart, days: daysInMonth(nextStart) - 1 })).filter((i) => !i.id.startsWith("sub-") && !i.id.startsWith("trial-") && i.kind !== "task")
    : [];
  const expectedTotal = expectedSubs.reduce((a, s) => a + (s.amount ?? 0), 0) + nextItems.filter((i) => i.isExpense).reduce((a, i) => a + (i.amount ?? 0), 0);

  const yearDense = yearKeys.map((k) => {
    const p = yearly.find((y) => y.period.slice(0, 7) === k);
    return { month: k, income: p?.income ?? 0, spent: p?.spent ?? 0, hasData: Boolean(p && p.tx_count > 0) };
  });
  const yearTotals = yearDense.reduce((a, m) => ({ income: a.income + m.income, spent: a.spent + m.spent }), { income: 0, spent: 0 });

  const monthOptions = monthKeys(currentMonth, 24)
    .reverse()
    .map((k) => ({ value: k, label: formatMonth(`${k}-01`) }));
  const hasAny = now.tx > 0 || prev.tx > 0 || yearDense.some((m) => m.income || m.spent);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Report · ${formatMonth(range.from)}`}
        description={isCurrent ? `Month to date (${formatDate(range.from, "short")} - ${formatDate(today, "short")}). Transfers between your own accounts are excluded.` : "Full month. Transfers between your own accounts are excluded."}
        actions={
          <>
            <MonthPicker basePath="/insights/reports" month={month} options={monthOptions} prev={shiftMonth(month, -1)} next={isCurrent ? null : shiftMonth(month, 1)} />
            <ReportActions from={range.from} to={range.to} />
          </>
        }
      />

      {!hasAny ? (
        <Card>
          <EmptyState icon={FileBarChart} title="Nothing to report for this month" description="Connect a bank or import a CSV to build reports." />
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="Income" value={formatMoney(now.income, currency)} hint={`Previous: ${formatMoney(prev.income, currency)}`} />
            <StatTile
              label="Spending"
              value={formatMoney(now.spent, currency)}
              delta={!isCurrent && prev.spent > 0 ? (now.spent - prev.spent) / prev.spent : null}
              deltaLabel={!isCurrent && prev.spent > 0 ? "vs previous month" : `Previous: ${formatMoney(prev.spent, currency)}`}
            />
            <StatTile label="Net" value={<span className={cn(net < 0 && "text-danger")}>{formatMoney(net, currency, { sign: true })}</span>} hint="Income minus spending" />
            <StatTile label="Savings rate" value={rate === null ? "-" : formatPercent(rate, 0, false)} hint={prevRate === null ? "No income last month" : `Previous: ${formatPercent(prevRate, 0, false)}`} />
            <StatTile label="Transactions" value={String(now.tx)} hint={`Previous: ${prev.tx}`} />
          </section>

          <Card>
            <CardHeader title="Spending by category" description={`${formatMonth(range.from)} vs ${formatMonth(prevRange.from)}${isCurrent ? " (full month)" : ""}`} />
            <div className="overflow-x-auto px-2 pb-3">
              <table className="data-table text-[13px]">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="text-right">{formatMonth(range.from, "short")}</th>
                    <th className="text-right">{formatMonth(prevRange.from, "short")}</th>
                    <th className="text-right">Difference</th>
                    <th className="text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {catRows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/finances/transactions?category=${c.id}&from=${range.from}&to=${range.to}`} className="flex items-center gap-2.5 hover:text-accent-text">
                          <CategoryIcon icon={c.icon} />
                          {c.name}
                        </Link>
                      </td>
                      <td className="tabular text-right font-medium">{formatMoney(c.now, currency)}</td>
                      <td className="tabular text-right text-secondary">{formatMoney(c.prev, currency)}</td>
                      <td className={cn("tabular text-right", c.now - c.prev > 0 ? "text-danger" : c.now - c.prev < 0 ? "text-positive" : "text-muted")}>
                        {formatMoney(c.now - c.prev, currency, { sign: true })}
                      </td>
                      <td className="tabular text-right text-muted">{now.spent > 0 ? `${Math.round((c.now / now.spent) * 100)}%` : "-"}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-medium">Total</td>
                    <td className="tabular text-right font-semibold">{formatMoney(now.spent, currency)}</td>
                    <td className="tabular text-right text-secondary">{formatMoney(prev.spent, currency)}</td>
                    <td className="tabular text-right text-secondary">{formatMoney(now.spent - prev.spent, currency, { sign: true })}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Top merchants & payees" />
              <CardBody>
                {merchants.length === 0 ? (
                  <p className="text-[12.5px] text-muted">No purchases this month.</p>
                ) : (
                  <ol className="divide-y divide-border">
                    {merchants.map((m, i) => (
                      <li key={m.merchant_key} className="flex items-center gap-3 py-2 text-[13px]">
                        <span className="w-4 text-right text-[11.5px] text-muted tabular">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{m.merchant}</span>
                        <span className="text-[12px] text-muted tabular">{m.tx_count}×</span>
                        <span className="w-24 text-right font-medium tabular">{formatMoney(m.spent, currency)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Biggest purchases" description="Rent, bills and subscriptions excluded" />
              <CardBody>
                {biggest.length === 0 ? (
                  <p className="text-[12.5px] text-muted">No purchases this month.</p>
                ) : (
                  <ol className="divide-y divide-border">
                    {biggest.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 py-2 text-[13px]">
                        <span className="w-14 shrink-0 text-[12px] text-muted">{formatDate(t.booked_at, "short")}</span>
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                          <span className="truncate">{t.merchant ?? t.description ?? "Purchase"}</span>
                          {t.is_demo && <DemoBadge />}
                        </span>
                        <span className="text-[12px] text-muted">{names.get(t.category_id ?? "")?.name ?? ""}</span>
                        <span className="w-24 text-right font-medium tabular">{formatMoney(-t.amount, t.currency)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Subscriptions & recurring payments paid" description={paid.length ? `${paid.length} payments · ${formatMoney(paidTotal, currency)} in total` : undefined} />
              <CardBody>
                {paid.length === 0 ? (
                  <p className="text-[12.5px] text-muted">No recurring payments recorded this month.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {paid.map((p) => (
                      <li key={p.id}>
                        <Link href={`/subscriptions/${p.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] hover:bg-surface-2">
                          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                            {p.name} {p.isDemo && <DemoBadge />}
                          </span>
                          {p.count > 1 && <span className="text-[12px] text-muted">{p.count}×</span>}
                          <span className="w-24 text-right font-medium tabular">{formatMoney(p.total, currency)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            {isCurrent ? (
              <Card>
                <CardHeader title={`Expected in ${formatMonth(nextStart)}`} description={expectedTotal > 0 ? `${formatMoney(expectedTotal, currency)} in known payments` : "Known renewals, bills and plans"} />
                <CardBody>
                  {expectedSubs.length === 0 && nextItems.length === 0 ? (
                    <p className="text-[12.5px] text-muted">Nothing known yet for next month.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {[
                        ...expectedSubs.map((s) => ({ key: `s-${s.id}-${s.date}`, date: s.date, title: s.name, amount: s.amount, currency: s.currency, isDemo: s.is_demo, href: `/subscriptions/${s.id}` })),
                        ...nextItems.map((i) => ({ key: i.id, date: i.date, title: i.title, amount: i.amount ?? null, currency: i.currency ?? currency, isDemo: i.isDemo, href: i.href })),
                      ]
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .map((i) => (
                          <li key={i.key}>
                            <Link href={i.href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] hover:bg-surface-2">
                              <span className="w-14 shrink-0 text-[12px] text-muted">{formatDate(i.date.slice(0, 10), "short")}</span>
                              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                                <span className="truncate">{i.title}</span> {i.isDemo && <DemoBadge />}
                              </span>
                              <span className="w-24 text-right font-medium tabular">{i.amount ? formatMoney(i.amount, i.currency ?? currency) : ""}</span>
                            </Link>
                          </li>
                        ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            ) : null}
          </section>

          <Card>
            <CardHeader title="Year overview" description={`${formatMonth(`${yearKeys[0]}-01`)} - ${formatMonth(range.from)}`} />
            <div className="overflow-x-auto px-2 pb-3">
              <table className="data-table text-[13px]">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="text-right">Income</th>
                    <th className="text-right">Spending</th>
                    <th className="text-right">Net</th>
                    <th className="text-right">Savings rate</th>
                  </tr>
                </thead>
                <tbody>
                  {yearDense.map((m) => {
                    const r = savingsRate(m.income, m.spent);
                    const n = m.income - m.spent;
                    if (!m.hasData) {
                      return (
                        <tr key={m.month} className="text-muted">
                          <td>{formatMonth(`${m.month}-01`)}</td>
                          <td colSpan={4} className="text-right text-[12px]">
                            No transactions
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={m.month} className={cn(m.month === month && "bg-accent-soft/40")}>
                        <td>
                          <Link href={`/insights/reports?month=${m.month}`} className="hover:text-accent-text">
                            {formatMonth(`${m.month}-01`)}
                          </Link>
                        </td>
                        <td className="tabular text-right">{formatMoney(m.income, currency)}</td>
                        <td className="tabular text-right">{formatMoney(m.spent, currency)}</td>
                        <td className={cn("tabular text-right", n < 0 ? "text-danger" : "text-secondary")}>{formatMoney(n, currency, { sign: true })}</td>
                        <td className="tabular text-right text-secondary">{r === null ? "-" : formatPercent(r, 0, false)}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="font-medium">12 months</td>
                    <td className="tabular text-right font-semibold">{formatMoney(yearTotals.income, currency)}</td>
                    <td className="tabular text-right font-semibold">{formatMoney(yearTotals.spent, currency)}</td>
                    <td className="tabular text-right font-semibold">{formatMoney(yearTotals.income - yearTotals.spent, currency, { sign: true })}</td>
                    <td className="tabular text-right text-secondary">
                      {(() => {
                        const r = savingsRate(yearTotals.income, yearTotals.spent);
                        return r === null ? "-" : formatPercent(r, 0, false);
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
