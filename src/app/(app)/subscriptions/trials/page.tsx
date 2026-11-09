import Link from "next/link";
import { ArrowRight, Hourglass } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { loadSubscriptions } from "@/lib/subscriptions/data";
import { CYCLE_UNIT } from "@/lib/subscriptions/helpers";
import { yearlyEquivalent } from "@/lib/finance/recurring";
import { addDays, daysBetween, toISODate } from "@/lib/dates";
import { formatDate, formatMoney } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { SubscriptionsHeader } from "@/components/subscriptions/subscriptions-header";
import { SubscriptionTable } from "@/components/subscriptions/subscription-table";
import { cn } from "@/lib/utils";
import { baseCurrency, subscriptionCategoryData } from "../shared";

export const metadata = { title: "Free trials" };

export default async function TrialsPage() {
  const { supabase } = await requireUser();
  const [subs, currency, cats] = await Promise.all([loadSubscriptions(supabase), baseCurrency(), subscriptionCategoryData()]);
  const todayIso = toISODate(new Date());
  const trials = subs.filter((s) => !s.dismissed && s.status === "trial").sort((a, b) => (a.trial_ends_at ?? "9999").localeCompare(b.trial_ends_at ?? "9999"));
  const converted = subs.filter(
    (s) => !s.dismissed && s.status === "active" && s.trial_ends_at && s.trial_ends_at < todayIso && s.trial_ends_at >= toISODate(addDays(new Date(), -90)),
  );

  return (
    <div className="space-y-6">
      <SubscriptionsHeader
        active="/subscriptions/trials"
        subscriptions={subs}
        categories={cats.options}
        description="Free trials quietly turn into paid plans. Decide before the end date - cancelling is always done by you, with the provider."
      />

      {trials.length === 0 ? (
        <Card>
          <EmptyState
            icon={Hourglass}
            title="No free trials running"
            description="Trials are picked up from 'your trial has started' emails in Gmail. You can also add one manually with Add subscription."
          />
        </Card>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {trials.map((s) => {
            const days = s.trial_ends_at ? daysBetween(todayIso, s.trial_ends_at) : null;
            const urgent = days !== null && days <= 3;
            return (
              <Card key={s.id} className={cn("flex flex-col p-5", urgent && "border-warning/40")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/subscriptions/${s.id}`} className="flex items-center gap-1.5 text-[14px] font-semibold hover:underline">
                      <span className="truncate">{s.name}</span>
                      {s.is_demo && <DemoBadge />}
                    </Link>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {s.amount ? `Then ${formatMoney(s.amount, s.currency)} per ${CYCLE_UNIT[s.billing_cycle]}` : "Then a paid plan"}
                    </p>
                  </div>
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", urgent ? "border-warning/30 bg-warning-soft text-warning" : "border-border bg-surface-2 text-secondary")}>
                    <Hourglass className="size-4" />
                  </span>
                </div>
                <div className="mt-5 flex items-end gap-2">
                  <span className={cn("text-[34px] leading-none font-semibold tracking-[-0.03em]", urgent && "text-warning")}>{days === null ? "?" : Math.max(days, 0)}</span>
                  <span className="pb-1 text-[13px] text-muted">{days === null ? "end date unknown" : days === 1 ? "day left" : days < 0 ? "days - trial has ended" : "days left"}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-muted">{s.trial_ends_at ? `Ends ${formatDate(s.trial_ends_at, "long")}` : "Add the end date via Edit"}</p>
                {s.amount ? (
                  <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-secondary">
                    Keeping it costs <span className="font-medium text-fg tabular">{formatMoney(yearlyEquivalent(s.amount, s.billing_cycle), s.currency)}</span> per year.
                  </p>
                ) : null}
                <div className="mt-4 flex flex-1 items-end">
                  <ButtonLink href={`/subscriptions/${s.id}#cancel`} variant={urgent ? "primary" : "secondary"} size="sm">
                    How to cancel <ArrowRight />
                  </ButtonLink>
                </div>
              </Card>
            );
          })}
        </section>
      )}

      {converted.length > 0 && (
        <Card>
          <CardHeader title="Recently converted to paid" description="Trials that ended in the last 90 days and are now charging" />
          <CardBody>
            <SubscriptionTable rows={converted} categoryIcons={cats.icons} searchable={false} />
          </CardBody>
        </Card>
      )}

      {trials.length > 0 && (
        <p className="text-[12px] text-muted">
          Totals in {currency}. Trial end dates come from your emails or your own entries - check the provider&apos;s account page if in doubt.
        </p>
      )}
    </div>
  );
}
