import { requireUser } from "@/lib/supabase/server";
import { loadSubscriptions } from "@/lib/subscriptions/data";
import { isCharging } from "@/lib/subscriptions/helpers";
import { monthlyEquivalent } from "@/lib/finance/recurring";
import { formatMoney } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SubscriptionsHeader } from "@/components/subscriptions/subscriptions-header";
import { SubscriptionTable } from "@/components/subscriptions/subscription-table";
import { baseCurrency, subscriptionCategoryData } from "../shared";

export const metadata = { title: "Active subscriptions" };

export default async function ActiveSubscriptionsPage() {
  const { supabase } = await requireUser();
  const [subs, currency, cats] = await Promise.all([loadSubscriptions(supabase), baseCurrency(), subscriptionCategoryData()]);
  const rows = subs.filter((s) => !s.dismissed && (s.status === "active" || s.status === "cancellation_pending" || s.status === "paused"));
  const monthly = rows.filter(isCharging).reduce((a, s) => a + monthlyEquivalent(s.amount, s.billing_cycle), 0);
  const pending = rows.filter((s) => s.status === "cancellation_pending").length;

  return (
    <div className="space-y-6">
      <SubscriptionsHeader active="/subscriptions/active" subscriptions={subs} categories={cats.options} />
      <Card>
        <CardHeader
          title={`${rows.length} active recurring payment${rows.length === 1 ? "" : "s"}`}
          description={`${formatMoney(monthly, currency)} per month · ${formatMoney(monthly * 12, currency, { decimals: 0 })} per year${pending ? ` · ${pending} with cancellation pending (still counted until confirmed)` : ""}`}
        />
        <CardBody>
          <SubscriptionTable rows={rows} categoryIcons={cats.icons} emptyMessage="No active subscriptions." />
        </CardBody>
      </Card>
    </div>
  );
}
