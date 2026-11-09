import Link from "next/link";
import { BellOff, SlidersHorizontal } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getProfile, listNotifications } from "@/lib/data/core";
import { dayKeyInTz, relativeDayKey, timeInTz } from "@/lib/calendar/time";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { MarkAllReadButton, NotificationCenter, RefreshNotificationsButton, type NotificationView } from "./notification-center";

export const metadata = { title: "Notifications" };

const TYPE_LABEL: Record<string, string> = {
  upcoming_payment: "Upcoming payment",
  upcoming_bill: "Upcoming bill",
  trial_ending: "Free trial",
  new_recurring: "New recurring payment",
  price_increase: "Price increase",
  large_purchase: "Large purchase",
  event_soon: "Event",
  unusual_spending: "Spending pattern",
  charge_after_cancel: "Charge after cancellation",
  cancellation_email: "Cancellation",
};

const SEVERITIES: { key: Severity | "all"; label: string }[] = [
  { key: "all", label: "All severities" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warnings" },
  { key: "info", label: "Info" },
  { key: "success", label: "Good news" },
];

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const sp = await searchParams;
  const unreadOnly = sp.filter === "unread";
  const severity = SEVERITIES.some((s) => s.key === sp.severity) ? (sp.severity as Severity | "all") : "all";
  const { supabase } = await requireUser();
  const profile = await getProfile();
  const tz = profile?.timezone ?? "Europe/Brussels";
  const today = dayKeyInTz(new Date(), tz);

  const all = await listNotifications(supabase, { limit: 300 });
  const unreadCount = all.filter((n) => !n.read_at).length;
  const filtered = all.filter((n) => (!unreadOnly || !n.read_at) && (severity === "all" || n.severity === severity));

  const items: NotificationView[] = filtered.map((n) => {
    const day = dayKeyInTz(n.created_at, tz);
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      severity: n.severity,
      link: n.link,
      read: Boolean(n.read_at),
      isDemo: n.is_demo,
      typeLabel: TYPE_LABEL[n.type] ?? "Notification",
      timeLabel: timeInTz(n.created_at, tz),
      dayGroup: relativeDayKey(day, today),
    };
  });

  const href = (next: { filter?: string; severity?: string }) => {
    const p = new URLSearchParams();
    const f = next.filter ?? (unreadOnly ? "unread" : undefined);
    const s = next.severity ?? (severity !== "all" ? severity : undefined);
    if (f && f !== "all") p.set("filter", f);
    if (s && s !== "all") p.set("severity", s);
    return `/notifications${p.size ? `?${p}` : ""}`;
  };
  const chip = (active: boolean) =>
    cn(
      "rounded-lg px-2.5 py-1 text-[12.5px] font-medium ring-1 transition-colors ring-inset",
      active ? "bg-surface-3 text-fg ring-border-strong" : "text-muted ring-border hover:text-secondary",
    );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread · alerts about payments, trials, price changes, large purchases, events and unusual spending`}
        actions={
          <>
            <MarkAllReadButton disabled={unreadCount === 0} />
            <RefreshNotificationsButton />
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Link href={href({ filter: "all" })} scroll={false} className={chip(!unreadOnly)}>
          All <span className="ml-1 text-[11px] text-muted tabular">{all.length}</span>
        </Link>
        <Link href={href({ filter: "unread" })} scroll={false} className={chip(unreadOnly)}>
          Unread <span className="ml-1 text-[11px] text-muted tabular">{unreadCount}</span>
        </Link>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {SEVERITIES.map((s) => (
          <Link key={s.key} href={href({ severity: s.key })} scroll={false} className={chip(severity === s.key)}>
            {s.label}
          </Link>
        ))}
        <ButtonLink href="/settings/preferences#notifications" variant="ghost" size="sm" className="ml-auto">
          <SlidersHorizontal /> Preferences
        </ButtonLink>
      </div>

      {items.length ? (
        <NotificationCenter items={items} />
      ) : (
        <Card>
          <EmptyState
            icon={BellOff}
            title={all.length ? "Nothing matches these filters" : "No notifications yet"}
            description={
              all.length
                ? "Try showing all notifications or another severity."
                : "You'll be alerted about upcoming payments, ending trials, price increases, large purchases, events and unusual spending. Use “Check now” to scan your data."
            }
          />
        </Card>
      )}
      <p className="mt-4 px-1 text-[11.5px] text-muted">
        Notifications are generated from your own synced data and shown inside the app only. Nothing is ever paid, cancelled or sent on your behalf.
      </p>
    </div>
  );
}
