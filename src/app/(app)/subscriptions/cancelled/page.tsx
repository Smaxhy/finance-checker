import Link from "next/link";
import { BellRing, OctagonAlert, XCircle } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { loadSubscriptionsData } from "@/lib/subscriptions/data";
import { CYCLE_UNIT } from "@/lib/subscriptions/helpers";
import { yearlyEquivalent } from "@/lib/finance/recurring";
import { formatDate, formatMoney, relativeDay } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { DemoBadge } from "@/components/ui/badge";
import { SubscriptionsHeader } from "@/components/subscriptions/subscriptions-header";
import { StatusBadge } from "@/components/subscriptions/status-badge";
import { baseCurrency, subscriptionCategoryData } from "../shared";

export const metadata = { title: "Cancelled subscriptions" };

export default async function CancelledPage() {
  const { supabase } = await requireUser();
  const [currency, cats] = await Promise.all([baseCurrency(), subscriptionCategoryData()]);
  const data = await loadSubscriptionsData(supabase, new Date(), currency);
  const subs = data.subscriptions;
  const pending = subs.filter((s) => !s.dismissed && s.status === "cancellation_pending");
  const cancelled = subs
    .filter((s) => !s.dismissed && (s.status === "cancelled" || s.status === "expired"))
    .sort((a, b) => (b.cancellation_confirmed_at ?? "").localeCompare(a.cancellation_confirmed_at ?? ""));
  const savings = cancelled.reduce((a, s) => a + yearlyEquivalent(s.amount, s.billing_cycle), 0);

  return (
    <div className="space-y-6">
      <SubscriptionsHeader
        active="/subscriptions/cancelled"
        subscriptions={subs}
        categories={cats.options}
        description="Only cancellations you've confirmed appear as cancelled. Requests still waiting for the provider stay visible until you confirm them."
      />

      <Card>
        <CardHeader title="Awaiting confirmation" description="You asked to cancel, but the provider hasn't confirmed yet - these can still charge you" />
        <CardBody>
          {pending.length === 0 ? (
            <p className="py-3 text-[13px] text-muted">No cancellations waiting for confirmation.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((s) => {
                const evidence = data.cancellationEmails.get(s.merchant_key) ?? [];
                return (
                  <li key={s.id}>
                    <Link href={`/subscriptions/${s.id}#cancel`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2">
                      <span className="flex size-7 items-center justify-center rounded-lg border border-warning/30 bg-warning-soft text-warning">
                        <BellRing className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[13px] font-medium">
                          {s.name} {s.is_demo && <DemoBadge />}
                        </p>
                        <p className="text-[12px] text-muted">
                          Requested {s.cancellation_requested_at ? relativeDay(s.cancellation_requested_at) : "—"}
                          {s.cancellation_deadline ? ` · deadline ${formatDate(s.cancellation_deadline, "short")}` : ""}
                          {evidence.length ? " · confirmation email found - review it" : ""}
                        </p>
                      </div>
                      <span className="text-[13px] tabular">
                        {formatMoney(s.amount, s.currency)} / {CYCLE_UNIT[s.billing_cycle]}
                      </span>
                      <StatusBadge status={s.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Cancelled"
          description={cancelled.length ? `You're saving about ${formatMoney(savings, currency, { decimals: 0 })} per year` : undefined}
        />
        <CardBody>
          {cancelled.length === 0 ? (
            <EmptyState icon={XCircle} title="No confirmed cancellations" description="When you confirm a cancellation on a subscription's page, it moves here and we keep watching for unexpected charges." className="py-8" />
          ) : (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="data-table stack-sm t-hide-c4 xl:min-w-[760px]">
                <thead>
                  <tr>
                    <th className="pl-5">Subscription</th>
                    <th className="text-right">Was</th>
                    <th>Confirmed</th>
                    <th>Reference</th>
                    <th className="text-right">Saved per year</th>
                    <th className="pr-5">After cancellation</th>
                  </tr>
                </thead>
                <tbody>
                  {cancelled.map((s) => {
                    const after = data.chargesAfterCancel.get(s.id) ?? [];
                    return (
                      <tr key={s.id}>
                        <td className="pl-5">
                          <Link href={`/subscriptions/${s.id}`} className="flex items-center gap-1.5 text-[13px] font-medium hover:underline">
                            {s.name} {s.is_demo && <DemoBadge />}
                          </Link>
                        </td>
                        <td data-label="Was" className="text-right text-[13px] whitespace-nowrap tabular">
                          {formatMoney(s.amount, s.currency)} <span className="text-muted">/ {CYCLE_UNIT[s.billing_cycle]}</span>
                        </td>
                        <td data-label="Confirmed" className="text-[13px] whitespace-nowrap">{s.cancellation_confirmed_at ? formatDate(s.cancellation_confirmed_at, "medium") : "—"}</td>
                        <td data-label="Reference" className="max-w-56 truncate text-[12.5px] text-secondary">{s.cancellation_reference ?? <span className="text-muted">—</span>}</td>
                        <td data-label="Saved per year" className="text-right text-[13px] text-positive tabular">{formatMoney(yearlyEquivalent(s.amount, s.billing_cycle), s.currency, { decimals: 0 })}</td>
                        <td data-label="Since then" className="pr-5">
                          {after.length ? (
                            <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-danger">
                              <OctagonAlert className="size-3.5" /> Charged {after.length}× since
                            </span>
                          ) : (
                            <span className="text-[12.5px] text-muted">No new charges</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
