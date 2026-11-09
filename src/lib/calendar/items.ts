// Holds no secrets: queries go through the caller's row-level-security client, so this
// also runs in the browser-only GitHub Pages edition (against on-device data).
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { CalendarEvent, EventKind, Subscription } from "@/lib/types";
import { getUpcoming, type UpcomingKind } from "@/lib/engines/upcoming";
import { must } from "@/lib/data/core";
import { projectChargeDates } from "./projection";
import { addDaysKey, dayKeyInTz, daysBetweenKeys, timeInTz, zonedToUtc } from "./time";

export interface CalItem {
  id: string;
  day: string; // YYYY-MM-DD in the user's timezone
  time: string | null; // HH:mm, null for all-day items
  endTime: string | null;
  allDay: boolean;
  kind: UpcomingKind;
  eventKind?: EventKind;
  title: string;
  subtitle?: string;
  amount: number | null;
  currency: string | null;
  /** Label next to the amount, e.g. "due at check-in". */
  amountLabel?: string;
  href: string;
  isDemo: boolean;
  isExpense: boolean;
  /** Second+ day of a multi-day event. */
  continued?: boolean;
  status?: CalendarEvent["status"];
  eventId?: string;
  source?: CalendarEvent["source"];
}

const BILL_CATEGORIES = new Set(["bills", "housing"]);

function eventItems(events: CalendarEvent[], from: string, to: string, tz: string): CalItem[] {
  const out: CalItem[] = [];
  for (const ev of events) {
    const startDay = dayKeyInTz(ev.starts_at, tz);
    // All-day ends are exclusive; timed events end on the day of their end instant.
    let endDay = startDay;
    if (ev.ends_at) {
      const endInstant = new Date(ev.ends_at);
      endDay = ev.all_day ? addDaysKey(dayKeyInTz(endInstant, tz), -1) : dayKeyInTz(endInstant, tz);
      if (endDay < startDay) endDay = startDay;
    }
    const span = Math.min(daysBetweenKeys(startDay, endDay), 13);
    const amount = ev.amount_due === null ? null : Number(ev.amount_due);
    const amountLabel = amount ? (ev.kind === "hotel" ? "due at check-in" : ev.payment_due_date ? "due" : "to pay") : undefined;
    for (let i = 0; i <= span; i++) {
      const day = addDaysKey(startDay, i);
      if (day < from || day > to) continue;
      out.push({
        id: `event-${ev.id}-${i}`,
        day,
        time: ev.all_day || i > 0 ? null : timeInTz(ev.starts_at, tz),
        endTime: ev.all_day || !ev.ends_at || span > 0 ? null : timeInTz(ev.ends_at, tz),
        allDay: ev.all_day || i > 0,
        kind: "event",
        eventKind: ev.kind,
        title: ev.title,
        subtitle: ev.location ?? ev.calendar_name ?? undefined,
        // Money is only counted once, on the first day.
        amount: i === 0 ? amount : null,
        currency: ev.currency,
        amountLabel: i === 0 ? amountLabel : undefined,
        href: `/calendar/events?id=${ev.id}`,
        isDemo: ev.is_demo,
        isExpense: i === 0 && Boolean(amount),
        continued: i > 0,
        status: ev.status,
        eventId: ev.id,
        source: ev.source,
      });
    }
  }
  return out;
}

function subscriptionItems(subs: Subscription[], from: string, to: string): CalItem[] {
  const out: CalItem[] = [];
  for (const s of subs) {
    if (s.status === "trial") continue; // the trial-end item covers it
    const dates = projectChargeDates(s.next_payment_date, s.billing_cycle, from, to);
    // A pending cancellation may still charge once, but not after that.
    const shown = s.status === "cancellation_pending" ? dates.slice(0, 1) : dates;
    const isBill = BILL_CATEGORIES.has(s.category_id ?? "");
    for (const day of shown) {
      out.push({
        id: `sub-${s.id}-${day}`,
        day,
        time: null,
        endTime: null,
        allDay: true,
        kind: isBill ? "bill" : "subscription",
        title: s.name,
        subtitle: s.status === "cancellation_pending" ? "Cancellation pending - may still charge" : isBill ? "Recurring bill" : "Subscription renewal",
        amount: s.amount === null ? null : Number(s.amount),
        currency: s.currency,
        href: `/subscriptions/${s.id}`,
        isDemo: s.is_demo,
        isExpense: true,
      });
    }
  }
  return out;
}

/**
 * Everything that happens on each day in [from, to] for one user: calendar
 * events (all sources), every projected recurring charge, bills from email,
 * trial ends, cancellation deadlines, event balances and tasks.
 */
export async function loadCalendarItems(supabase: AppSupabaseClient, userId: string, from: string, to: string, tz: string): Promise<CalItem[]> {
  const fromInstant = zonedToUtc(from, "00:00", tz);
  const toInstant = zonedToUtc(addDaysKey(to, 1), "00:00", tz);
  // Multi-day events that started before the window still overlap it.
  const lookback = new Date(fromInstant.getTime() - 14 * 86_400_000).toISOString();

  const [eventsRes, subsRes, upcoming] = await Promise.all([
    supabase
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .gte("starts_at", lookback)
      .lt("starts_at", toInstant.toISOString())
      .order("starts_at")
      .limit(2000),
    supabase.from("subscriptions").select("*").eq("user_id", userId).in("status", ["active", "cancellation_pending", "trial"]).eq("dismissed", false),
    // getUpcoming supplies bills from email, trial ends, deadlines, event balances and tasks.
    getUpcoming(supabase, userId, { from: new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10))), days: daysBetweenKeys(from, to) + 1 }),
  ]);

  const events = (must(eventsRes, "events") as CalendarEvent[]).filter((e) => !e.ends_at || new Date(e.ends_at) > fromInstant || new Date(e.starts_at) >= fromInstant);
  const subs = must(subsRes, "subscriptions") as Subscription[];

  const extra: CalItem[] = upcoming
    // events and subscription charges are built above with full detail / projection
    .filter((u) => !u.id.startsWith("event-") && !u.id.startsWith("sub-"))
    .map((u) => {
      const day = dayKeyInTz(u.date, tz);
      return {
        id: u.id,
        day,
        time: u.allDay || u.date.length === 10 ? null : timeInTz(u.date, tz),
        endTime: null,
        allDay: u.allDay || u.date.length === 10,
        kind: u.kind,
        eventKind: u.eventKind,
        title: u.title,
        subtitle: u.subtitle,
        amount: u.amount ?? null,
        currency: u.currency ?? null,
        amountLabel: u.kind === "payment_due" ? "due" : undefined,
        href: u.href,
        isDemo: u.isDemo,
        isExpense: u.isExpense,
      } satisfies CalItem;
    })
    .filter((i) => i.day >= from && i.day <= to);

  const projected = subscriptionItems(subs, from, to);
  // An emailed invoice for a recurring charge we already project (same payee, same
  // amount, within a few days) is the same payment - keep only one so totals don't double.
  const deduped = extra.filter((i) => {
    if (!i.id.startsWith("email-") || !i.amount) return true;
    return !projected.some(
      (p) =>
        p.amount !== null &&
        Math.abs(p.amount - i.amount!) < 0.01 &&
        Math.abs(daysBetweenKeys(p.day, i.day)) <= 3 &&
        i.title.toLowerCase().startsWith(p.title.toLowerCase().split(" ")[0]),
    );
  });

  return [...eventItems(events, from, to, tz), ...projected, ...deduped].sort(
    (a, b) => a.day.localeCompare(b.day) || Number(b.allDay) - Number(a.allDay) || (a.time ?? "").localeCompare(b.time ?? ""),
  );
}

export function groupByDay(items: CalItem[]): Map<string, CalItem[]> {
  const map = new Map<string, CalItem[]>();
  for (const i of items) {
    const list = map.get(i.day);
    if (list) list.push(i);
    else map.set(i.day, [i]);
  }
  return map;
}

export function expectedTotal(items: CalItem[]): number {
  return items.reduce((acc, i) => acc + (i.isExpense && i.amount ? i.amount : 0), 0);
}

export async function userTimezone(supabase: AppSupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return (data?.timezone as string | undefined) ?? "Europe/Brussels";
}

export async function calendarConnectionState(supabase: AppSupabaseClient): Promise<"connected" | "missing" | "error"> {
  const { data } = await supabase.from("connections").select("status, scopes").eq("provider", "google");
  const rows = (data ?? []) as { status: string; scopes: string[] }[];
  const withCalendar = rows.filter((r) => r.scopes.includes("https://www.googleapis.com/auth/calendar.readonly"));
  if (withCalendar.length === 0) return "missing";
  return withCalendar.some((r) => r.status === "active") ? "connected" : "error";
}
