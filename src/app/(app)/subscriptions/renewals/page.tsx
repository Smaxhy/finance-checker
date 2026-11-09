import Link from "next/link";
import { CalendarClock, Hourglass, Repeat, TriangleAlert } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { loadSubscriptions } from "@/lib/subscriptions/data";
import { CYCLE_LABEL, isBill, renewalsWithin, type RenewalItem } from "@/lib/subscriptions/helpers";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, StatTile } from "@/components/ui/misc";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { SubscriptionsHeader } from "@/components/subscriptions/subscriptions-header";
import { cn } from "@/lib/utils";
import { baseCurrency, subscriptionCategoryData } from "../shared";

export const metadata = { title: "Upcoming renewals" };

const WINDOWS = [30, 60, 90] as const;

function groupByMonth(items: RenewalItem[]) {
  const groups = new Map<string, RenewalItem[]>();
  for (const i of items) {
    const key = i.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups.entries()];
}

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireUser();
  const sp = await searchParams;
  const days = WINDOWS.find((w) => String(w) === sp.days) ?? 30;
  const [subs, currency, cats] = await Promise.all([loadSubscriptions(supabase), baseCurrency(), subscriptionCategoryData()]);
  const items = renewalsWithin(subs, days);
  const total = items.reduce((a, i) => a + (i.amount ?? 0), 0);
  const annual = items.filter((i) => i.subscription.billing_cycle === "yearly" || i.subscription.billing_cycle === "semiannual");
  const trials = items.filter((i) => i.kind === "trial_conversion");

  return (
    <div className="space-y-6">
      <SubscriptionsHeader active="/subscriptions/renewals" subscriptions={subs} categories={cats.options} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-border" role="tablist" aria-label="Time window">
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={`/subscriptions/renewals?days=${w}`}
              role="tab"
              aria-selected={w === days}
              className={cn("rounded-md px-3 py-1 text-[12.5px] font-medium transition-all", w === days ? "bg-surface-3 text-fg shadow-sm" : "text-muted hover:text-secondary")}
            >
              Next {w} days
            </Link>
          ))}
        </div>
        <p className="text-[12px] text-muted">Dates are projected from past charges and emails - providers can shift them by a day or two.</p>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={`Expected in ${days} days`} icon={CalendarClock} value={formatMoney(total, currency)} hint={`${items.length} payment${items.length === 1 ? "" : "s"}`} />
        <StatTile
          label="Annual renewals"
          icon={Repeat}
          value={String(annual.length)}
          hint={annual.length ? `${formatMoney(annual.reduce((a, i) => a + (i.amount ?? 0), 0), currency)} - review before they renew` : "None in this window"}
        />
        <StatTile label="Trials converting" icon={Hourglass} value={String(trials.length)} hint={trials.length ? "Cancel before the date to avoid charges" : "None in this window"} />
      </section>

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarClock} title={`No renewals in the next ${days} days`} description="Try a longer window, or add subscriptions that weren't detected." />
        </Card>
      ) : (
        groupByMonth(items).map(([month, group]) => (
          <Card key={month}>
            <CardHeader title={formatMonth(`${month}-01`)} description={`${formatMoney(group.reduce((a, i) => a + (i.amount ?? 0), 0), currency)} across ${group.length} payment${group.length === 1 ? "" : "s"}`} />
            <CardBody>
              <ul className="divide-y divide-border">
                {group.map((i) => {
                  const s = i.subscription;
                  const deadlineSoon = s.cancellation_deadline && s.cancellation_deadline >= new Date().toISOString().slice(0, 10) && s.cancellation_deadline <= i.date;
                  return (
                    <li key={`${s.id}-${i.date}`}>
                      <Link href={`/subscriptions/${s.id}`} className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2">
                        <div className="w-11 shrink-0 text-center">
                          <p className="text-[10.5px] font-medium tracking-wide text-muted uppercase">{formatDate(i.date, "short").split(" ")[1]}</p>
                          <p className="text-[17px] leading-tight font-semibold tabular">{Number(i.date.slice(8, 10))}</p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                            {s.name}
                            {s.is_demo && <DemoBadge />}
                            {i.kind === "trial_conversion" && <Badge tone="accent">Trial converts</Badge>}
                            {(s.billing_cycle === "yearly" || s.billing_cycle === "semiannual") && <Badge tone="warning">{CYCLE_LABEL[s.billing_cycle]} renewal</Badge>}
                            {s.status === "cancellation_pending" && <Badge tone="warning">Cancellation pending</Badge>}
                            {isBill(s) && <Badge tone="outline">Bill</Badge>}
                          </p>
                          <p className="text-[12px] text-muted">
                            {i.daysAway === 0 ? "Today" : i.daysAway === 1 ? "Tomorrow" : `In ${i.daysAway} days`} · {formatDate(i.date, "long")}
                            {s.payment_method ? ` · ${s.payment_method}` : ""}
                          </p>
                          {deadlineSoon && (
                            <p className="mt-0.5 flex items-center gap-1 text-[12px] text-warning">
                              <TriangleAlert className="size-3" /> Cancellation deadline {formatDate(s.cancellation_deadline, "medium")}
                            </p>
                          )}
                        </div>
                        <span className="text-[13.5px] font-medium tabular">{formatMoney(i.amount, s.currency)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
