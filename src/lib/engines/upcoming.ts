import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { BillingCycle, CalendarEvent, EventKind, Subscription, Task } from "@/lib/types";
import { addDays, startOfDay, toISODate } from "@/lib/dates";
import { must } from "@/lib/data/core";

export type UpcomingKind = "subscription" | "bill" | "trial_end" | "cancellation_deadline" | "payment_due" | "event" | "task";

export interface UpcomingItem {
  id: string;
  date: string; // ISO date or datetime
  allDay: boolean;
  kind: UpcomingKind;
  eventKind?: EventKind;
  title: string;
  subtitle?: string;
  amount?: number | null;
  currency?: string | null;
  href: string;
  isDemo: boolean;
  /** true when this is money expected to leave the account */
  isExpense: boolean;
}

const RECURRING_BILL_CATEGORIES = new Set(["bills", "housing"]);

/**
 * Projects a recurring subscription's future charges inside the window
 * (a weekly plan can bill several times in 30 days).
 */
function projectCharges(sub: Subscription, until: string): string[] {
  if (!sub.next_payment_date) return [];
  const dates: string[] = [];
  let d = sub.next_payment_date;
  const step: Record<BillingCycle, number> = { weekly: 7, monthly: 0, quarterly: 0, semiannual: 0, yearly: 0, unknown: 0 };
  dates.push(d);
  if (step[sub.billing_cycle] > 0) {
    while (true) {
      const [y, m, day] = d.split("-").map(Number);
      const next = toISODate(addDays(new Date(y, m - 1, day), step[sub.billing_cycle]));
      if (next > until) break;
      dates.push(next);
      d = next;
    }
  }
  return dates.filter((x) => x <= until);
}

/**
 * Upcoming payments, renewals, trials, bills, events and tasks for one user.
 * Always filters by userId explicitly so it is also safe with the service-role
 * client (cron), which bypasses row-level security.
 */
export async function getUpcoming(supabase: AppSupabaseClient, userId: string, opts: { days?: number; from?: Date } = {}): Promise<UpcomingItem[]> {
  const from = startOfDay(opts.from ?? new Date());
  const fromIso = toISODate(from);
  const until = toISODate(addDays(from, opts.days ?? 30));
  const untilTs = addDays(from, (opts.days ?? 30) + 1).toISOString();

  const [subs, emails, events, tasks] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", userId).in("status", ["active", "trial", "cancellation_pending"]).eq("dismissed", false),
    supabase
      .from("emails")
      .select("id, subject, merchant, amount, currency, due_date, category, is_demo")
      .eq("user_id", userId)
      .not("due_date", "is", null)
      .gte("due_date", fromIso)
      .lte("due_date", until),
    supabase.from("events").select("*").eq("user_id", userId).neq("status", "cancelled").gte("starts_at", from.toISOString()).lt("starts_at", untilTs).order("starts_at"),
    supabase.from("tasks").select("*").eq("user_id", userId).is("completed_at", null).not("due_at", "is", null).lt("due_at", untilTs),
  ]);

  const items: UpcomingItem[] = [];

  for (const s of must(subs, "subscriptions") as Subscription[]) {
    const amount = s.amount === null ? null : Number(s.amount);
    if (s.status !== "trial") {
      for (const date of projectCharges(s, until)) {
        if (date < fromIso) continue;
        const isBill = RECURRING_BILL_CATEGORIES.has(s.category_id ?? "");
        items.push({
          id: `sub-${s.id}-${date}`,
          date,
          allDay: true,
          kind: isBill ? "bill" : "subscription",
          title: s.name,
          subtitle: s.status === "cancellation_pending" ? "Cancellation pending - may still charge" : isBill ? "Recurring bill" : "Subscription renewal",
          amount,
          currency: s.currency,
          href: `/subscriptions/${s.id}`,
          isDemo: s.is_demo,
          isExpense: true,
        });
      }
    }
    if (s.trial_ends_at && s.trial_ends_at >= fromIso && s.trial_ends_at <= until) {
      items.push({
        id: `trial-${s.id}`,
        date: s.trial_ends_at,
        allDay: true,
        kind: "trial_end",
        title: `${s.name} free trial ends`,
        subtitle: amount ? `Then billed automatically` : "Converts to a paid plan unless cancelled",
        amount,
        currency: s.currency,
        href: `/subscriptions/${s.id}`,
        isDemo: s.is_demo,
        isExpense: true,
      });
    }
    if (s.cancellation_deadline && s.cancellation_deadline >= fromIso && s.cancellation_deadline <= until) {
      items.push({
        id: `deadline-${s.id}`,
        date: s.cancellation_deadline,
        allDay: true,
        kind: "cancellation_deadline",
        title: `Cancel ${s.name} before this date`,
        subtitle: "Cancellation deadline",
        href: `/subscriptions/${s.id}`,
        isDemo: s.is_demo,
        isExpense: false,
      });
    }
  }

  for (const e of must(emails, "emails") as { id: string; subject: string | null; merchant: string | null; amount: number | null; currency: string | null; due_date: string; category: string; is_demo: boolean }[]) {
    items.push({
      id: `email-${e.id}`,
      date: e.due_date,
      allDay: true,
      kind: "bill",
      title: e.merchant ? `${e.merchant} payment due` : (e.subject ?? "Payment due"),
      subtitle: "From an email invoice",
      amount: e.amount === null ? null : Number(e.amount),
      currency: e.currency,
      href: `/emails?id=${e.id}`,
      isDemo: e.is_demo,
      isExpense: true,
    });
  }

  for (const ev of must(events, "events") as CalendarEvent[]) {
    items.push({
      id: `event-${ev.id}`,
      date: ev.starts_at,
      allDay: ev.all_day,
      kind: "event",
      eventKind: ev.kind,
      title: ev.title,
      subtitle: ev.location ?? ev.calendar_name ?? undefined,
      amount: ev.amount_due === null ? null : Number(ev.amount_due),
      currency: ev.currency,
      href: `/calendar/events?id=${ev.id}`,
      isDemo: ev.is_demo,
      isExpense: Boolean(ev.amount_due),
    });
    if (ev.payment_due_date && ev.amount_due && ev.payment_due_date >= fromIso && ev.payment_due_date <= until && ev.payment_due_date !== ev.starts_at.slice(0, 10)) {
      items.push({
        id: `eventpay-${ev.id}`,
        date: ev.payment_due_date,
        allDay: true,
        kind: "payment_due",
        title: `Balance due: ${ev.title}`,
        amount: Number(ev.amount_due),
        currency: ev.currency,
        href: `/calendar/events?id=${ev.id}`,
        isDemo: ev.is_demo,
        isExpense: true,
      });
    }
  }

  for (const t of must(tasks, "tasks") as Task[]) {
    items.push({
      id: `task-${t.id}`,
      date: t.due_at!,
      allDay: false,
      kind: "task",
      title: t.title,
      subtitle: t.due_at! < from.toISOString() ? "Overdue" : t.is_reminder ? "Reminder" : "Task",
      href: `/calendar/tasks`,
      isDemo: t.is_demo,
      isExpense: false,
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export function sumExpected(items: UpcomingItem[]): number {
  return items.filter((i) => i.isExpense && i.amount).reduce((acc, i) => acc + (i.amount ?? 0), 0);
}
