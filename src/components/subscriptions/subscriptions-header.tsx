import { PageHeader, Tabs } from "@/components/ui/misc";
import type { Subscription } from "@/lib/types";
import { renewalsWithin } from "@/lib/subscriptions/helpers";
import { AddSubscriptionDialog } from "./add-subscription-dialog";
import type { CategoryOption } from "./subscription-form";

export const SUBSCRIPTION_TABS = ["/subscriptions", "/subscriptions/active", "/subscriptions/trials", "/subscriptions/cancelled", "/subscriptions/renewals"] as const;

export function SubscriptionsHeader({
  active,
  subscriptions,
  categories,
  openNew = false,
  description,
}: {
  active: (typeof SUBSCRIPTION_TABS)[number];
  subscriptions: Subscription[];
  categories: CategoryOption[];
  openNew?: boolean;
  description?: string;
}) {
  const visible = subscriptions.filter((s) => !s.dismissed);
  const count = (pred: (s: Subscription) => boolean) => visible.filter(pred).length;
  return (
    <PageHeader
      title="Subscriptions"
      description={description ?? "Recurring payments found in your bank transactions and emails. Nothing is ever cancelled without you."}
      actions={<AddSubscriptionDialog categories={categories} initialOpen={openNew} />}
    >
      <Tabs
        active={active}
        items={[
          { href: "/subscriptions", label: "Overview" },
          { href: "/subscriptions/active", label: "Active", count: count((s) => s.status === "active" || s.status === "cancellation_pending" || s.status === "paused") },
          { href: "/subscriptions/trials", label: "Trials", count: count((s) => s.status === "trial") },
          { href: "/subscriptions/cancelled", label: "Cancelled", count: count((s) => s.status === "cancelled" || s.status === "expired") },
          { href: "/subscriptions/renewals", label: "Upcoming Renewals", count: renewalsWithin(visible, 30).length },
        ]}
      />
    </PageHeader>
  );
}
