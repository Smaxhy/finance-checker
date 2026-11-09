import Link from "next/link";
import { ArrowRight, CalendarClock, Hourglass, PiggyBank, ReceiptText, Repeat, Wallet } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { loadSubscriptionsData } from "@/lib/subscriptions/data";
import { computeTotals, isBill, isLive, renewalsWithin, CYCLE_UNIT } from "@/lib/subscriptions/helpers";
import { monthlyEquivalent } from "@/lib/finance/recurring";
import { formatDate, formatMoney, relativeDay } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, StatTile } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { DemoBadge } from "@/components/ui/badge";
import { SubscriptionsHeader } from "@/components/subscriptions/subscriptions-header";
import { SubscriptionTable } from "@/components/subscriptions/subscription-table";
import { AttentionPanel } from "@/components/subscriptions/attention-panel";
import { StatusBadge } from "@/components/subscriptions/status-badge";
import { baseCurrency, subscriptionCategoryData } from "./shared";

export const metadata = { title: "Subscriptions" };

export default async function SubscriptionsOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireUser();
  const sp = await searchParams;
  const today = new Date();
  const [currency, cats] = await Promise.all([baseCurrency(), subscriptionCategoryData()]);
  const data = await loadSubscriptionsData(supabase, today, currency);
  const subs = data.subscriptions;
  const totals = computeTotals(subs);
  const live = subs.filter(isLive);
  const services = live.filter((s) => !isBill(s));
  const bills = live.filter(isBill);
  const dismissed = subs.filter((s) => s.dismissed);
  const soon = renewalsWithin(subs, 14, today);
  const costBars = services
    .filter((s) => s.status !== "trial")
    .map((s) => ({ s, monthly: monthlyEquivalent(s.amount, s.billing_cycle) }))
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 8);
  const maxBar = Math.max(1, ...costBars.map((c) => c.monthly));

  return (
    <div className="space-y-6">
      <SubscriptionsHeader active="/subscriptions" subscriptions={subs} categories={cats.options} openNew={sp.new === "1"} />

      {subs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Repeat}
            title="No subscriptions tracked yet"
            description="They're detected automatically from bank transactions (or CSV imports) and from receipts in Gmail. You can also add one manually."
            action={
              <>
                <ButtonLink href="/settings/accounts" variant="secondary">
                  Connect accounts
                </ButtonLink>
                <ButtonLink href="/finances/transactions?import=1" variant="ghost">
                  Import a bank CSV
                </ButtonLink>
              </>
            }
          />
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Subscription totals">
            <StatTile label="Recurring per month" icon={Wallet} value={formatMoney(totals.monthly, currency)} hint={`${formatMoney(totals.yearly, currency, { decimals: 0 })} per year`} />
            <StatTile
              label="Subscriptions"
              icon={Repeat}
              value={formatMoney(totals.monthlySubscriptions, currency)}
              hint={`${totals.countSubscriptions} services · ${formatMoney(totals.monthlySubscriptions * 12, currency, { decimals: 0 })}/yr`}
            />
            <StatTile
              label="Bills & fixed costs"
              icon={ReceiptText}
              value={formatMoney(totals.monthlyBills, currency)}
              hint={`${totals.countBills} recurring bills · rent, utilities, telecom`}
            />
            <StatTile
              label="Free trials"
              icon={Hourglass}
              value={String(totals.trialCount)}
              hint={totals.trialCount ? `${formatMoney(totals.trialMonthlyIfKept, currency)}/mo if you keep them` : "None running"}
            />
            <StatTile
              label="Saved by cancelling"
              icon={PiggyBank}
              value={formatMoney(totals.cancelledYearlySavings, currency, { decimals: 0 })}
              hint={totals.pendingCount ? `per year · ${totals.pendingCount} cancellation${totals.pendingCount === 1 ? "" : "s"} pending` : "per year, from confirmed cancellations"}
            />
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Needs your attention" description="Price changes, overlaps, trials, unconfirmed cancellations and new detections" />
              <CardBody>
                <AttentionPanel items={data.attention} />
              </CardBody>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardHeader
                  title="Next 14 days"
                  description={soon.length ? `${formatMoney(soon.reduce((a, r) => a + (r.amount ?? 0), 0), currency)} expected` : undefined}
                  action={
                    <ButtonLink href="/subscriptions/renewals" variant="ghost" size="sm">
                      All <ArrowRight />
                    </ButtonLink>
                  }
                />
                <CardBody>
                  {soon.length ? (
                    <ul className="divide-y divide-border">
                      {soon.slice(0, 6).map((r) => (
                        <li key={`${r.subscription.id}-${r.date}`}>
                          <Link href={`/subscriptions/${r.subscription.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
                            <CalendarClock className="size-4 shrink-0 text-muted" />
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                                <span className="truncate">{r.subscription.name}</span>
                                {r.subscription.is_demo && <DemoBadge />}
                              </p>
                              <p className="text-[12px] text-muted">
                                {r.kind === "trial_conversion" ? "Trial converts" : "Renews"} {relativeDay(r.date)} · {formatDate(r.date, "short")}
                              </p>
                            </div>
                            <span className="text-[13px] font-medium tabular">{formatMoney(r.amount, r.subscription.currency)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-4 text-[13px] text-muted">No renewals in the next two weeks.</p>
                  )}
                </CardBody>
              </Card>
              {costBars.length > 0 && (
                <Card>
                  <CardHeader title="Biggest subscriptions" description="Monthly equivalent, bills excluded" />
                  <CardBody>
                    <ul className="space-y-2.5">
                      {costBars.map(({ s, monthly }) => (
                        <li key={s.id}>
                          <Link href={`/subscriptions/${s.id}`} className="group block">
                            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                              <span className="truncate text-secondary group-hover:text-fg">{s.name}</span>
                              <span className="font-medium tabular">{formatMoney(monthly, s.currency)}</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                              <div className="h-full rounded-full bg-[var(--chart-spend)] transition-[width] duration-700" style={{ width: `${(monthly / maxBar) * 100}%` }} />
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}
            </div>
          </section>

          <Card>
            <CardHeader
              title="Subscriptions & services"
              description={`${services.length} running · ${formatMoney(services.filter((s) => s.status !== "trial").reduce((a, s) => a + monthlyEquivalent(s.amount, s.billing_cycle), 0), currency)} per month`}
            />
            <CardBody>
              <SubscriptionTable rows={services} categoryIcons={cats.icons} emptyMessage="No subscriptions detected yet." />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Bills & recurring payments" description="Rent, utilities, telecom, insurance and other fixed costs that repeat" />
            <CardBody>
              <SubscriptionTable rows={bills} categoryIcons={cats.icons} emptyMessage="No recurring bills detected yet." searchable={false} />
            </CardBody>
          </Card>

          {dismissed.length > 0 && (
            <Card>
              <CardHeader title="Dismissed" description="You marked these as not being subscriptions. They're excluded from totals and won't be flagged again." />
              <CardBody>
                <ul className="flex flex-wrap gap-2">
                  {dismissed.map((s) => (
                    <li key={s.id}>
                      <Link href={`/subscriptions/${s.id}`} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] text-secondary hover:border-border-strong hover:text-fg">
                        {s.name}
                        <span className="text-muted tabular">
                          {formatMoney(s.amount, s.currency)}/{CYCLE_UNIT[s.billing_cycle]}
                        </span>
                        <StatusBadge status={s.status} dismissed />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
