import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/core";
import { integrationStatus } from "@/lib/env";
import { calendarConnectionState, expectedTotal, groupByDay, loadCalendarItems, type CalItem } from "@/lib/calendar/items";
import { addDaysKey, dayKeyInTz, formatDayKey, relativeDayKey, startOfWeekKey, timeInTz, weekKeys } from "@/lib/calendar/time";
import { formatMoney } from "@/lib/format";
import type { CalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { CalendarTabs } from "@/components/calendar/calendar-tabs";
import { AgendaList, ItemIcon, isWarning } from "@/components/calendar/agenda";
import { NewEventButton } from "@/components/calendar/event-form";
import { EventDetailDialog, type EventDetailData } from "@/components/calendar/event-detail";
import { CalendarSetupNotice } from "../setup-notice";

export const metadata = { title: "Events" };

const isKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function whenLabel(ev: CalendarEvent, tz: string): string {
  const startDay = dayKeyInTz(ev.starts_at, tz);
  const dayFmt = { weekday: "long", day: "numeric", month: "long", year: "numeric" } as const;
  if (ev.all_day) {
    const endDay = ev.ends_at ? addDaysKey(dayKeyInTz(ev.ends_at, tz), -1) : startDay;
    return endDay > startDay ? `${formatDayKey(startDay, { day: "numeric", month: "short" })} – ${formatDayKey(endDay, dayFmt)} · all day` : `${formatDayKey(startDay, dayFmt)} · all day`;
  }
  const start = `${formatDayKey(startDay, dayFmt)} · ${timeInTz(ev.starts_at, tz)}`;
  if (!ev.ends_at) return start;
  const endDay = dayKeyInTz(ev.ends_at, tz);
  return endDay === startDay ? `${start} – ${timeInTz(ev.ends_at, tz)}` : `${start} – ${formatDayKey(endDay, { day: "numeric", month: "short" })} ${timeInTz(ev.ends_at, tz)}`;
}

function cellClass(i: CalItem) {
  if (isWarning(i)) return "border-warning/30 bg-warning-soft text-warning";
  if (i.kind === "event") return cn("border-accent/25 bg-accent-soft text-fg", i.continued && "opacity-60", i.status === "cancelled" && "opacity-50 line-through");
  return "border-border bg-surface-2 text-secondary";
}

export default async function EventsPage({ searchParams }: PageProps<"/calendar/events">) {
  const sp = await searchParams;
  const { supabase, user } = await requireUser();
  const profile = await getProfile();
  const tz = profile?.timezone ?? "Europe/Brussels";
  const currency = profile?.base_currency ?? "EUR";
  const today = dayKeyInTz(new Date(), tz);
  const eventId = typeof sp.id === "string" && /^[0-9a-f-]{36}$/i.test(sp.id) ? sp.id : null;
  const { data: eventRow } = eventId ? await supabase.from("events").select("*").eq("id", eventId).maybeSingle() : { data: null };
  const event = (eventRow as CalendarEvent | null) ?? null;
  // Deep links (?id=) without a week open on the week of that event.
  const anchor = isKey(sp.week) ? sp.week : event ? dayKeyInTz(event.starts_at, tz) : today;
  const weekStart = startOfWeekKey(anchor);
  const days = weekKeys(weekStart);
  const selectedDay = isKey(sp.day) && days.includes(sp.day) ? sp.day : event && days.includes(dayKeyInTz(event.starts_at, tz)) ? dayKeyInTz(event.starts_at, tz) : days.includes(today) ? today : weekStart;

  const [items, connection] = await Promise.all([loadCalendarItems(supabase, user.id, days[0], days[6], tz), calendarConnectionState(supabase)]);
  const byDay = groupByDay(items);

  let detail: EventDetailData | null = null;
  if (event) {
    const { data: email } = event.email_id ? await supabase.from("emails").select("subject").eq("id", event.email_id).maybeSingle() : { data: null };
    const startDay = dayKeyInTz(event.starts_at, tz);
    const endDay = event.ends_at ? (event.all_day ? addDaysKey(dayKeyInTz(event.ends_at, tz), -1) : dayKeyInTz(event.ends_at, tz)) : startDay;
    detail = {
      event,
      whenLabel: whenLabel(event, tz),
      paymentDueLabel: event.payment_due_date ? formatDayKey(event.payment_due_date, { weekday: "short", day: "numeric", month: "short" }) : null,
      emailSubject: (email?.subject as string | undefined) ?? null,
      form:
        event.source === "manual"
          ? {
              id: event.id,
              title: event.title,
              date: startDay,
              endDate: endDay,
              allDay: event.all_day,
              startTime: event.all_day ? "09:00" : timeInTz(event.starts_at, tz),
              endTime: event.all_day || !event.ends_at ? "10:00" : timeInTz(event.ends_at, tz),
              location: event.location ?? "",
              description: event.description ?? "",
              kind: event.kind,
              amountDue: event.amount_due ? String(event.amount_due) : "",
              paymentDueDate: event.payment_due_date ?? "",
            }
          : null,
    };
  }

  const weekEvents = items.filter((i) => i.kind === "event" && !i.continued).length;
  const weekExpected = expectedTotal(items);
  const prevWeek = addDaysKey(weekStart, -7);
  const nextWeek = addDaysKey(weekStart, 7);
  const isThisWeek = days.includes(today);
  const selectedItems = byDay.get(selectedDay) ?? [];

  return (
    <div>
      <PageHeader
        title="Events"
        description={
          <>
            {formatDayKey(days[0], { day: "numeric", month: "short" })} – {formatDayKey(days[6], { day: "numeric", month: "short", year: "numeric" })} · {weekEvents} event
            {weekEvents === 1 ? "" : "s"}
            {weekExpected > 0 ? ` · ${formatMoney(weekExpected, currency)} expected` : ""}
          </>
        }
        actions={
          <>
            <div className="flex items-center rounded-lg border border-border bg-surface">
              <ButtonLink href={`/calendar/events?week=${prevWeek}`} variant="ghost" size="icon" aria-label="Previous week" scroll={false}>
                <ChevronLeft />
              </ButtonLink>
              <span className="min-w-28 px-1 text-center text-[13px] font-medium">{isThisWeek ? "This week" : `Week of ${formatDayKey(weekStart, { day: "numeric", month: "short" })}`}</span>
              <ButtonLink href={`/calendar/events?week=${nextWeek}`} variant="ghost" size="icon" aria-label="Next week" scroll={false}>
                <ChevronRight />
              </ButtonLink>
            </div>
            {!isThisWeek && (
              <ButtonLink href="/calendar/events" variant="secondary">
                Today
              </ButtonLink>
            )}
            <NewEventButton date={selectedDay} />
          </>
        }
      >
        <CalendarTabs active="/calendar/events" />
      </PageHeader>

      <CalendarSetupNotice state={connection} googleConfigured={integrationStatus().google.configured} missing={integrationStatus().google.missing} />

      {/* Phones: a 7-day strip; the agenda below shows the chosen day. */}
      <nav aria-label="Days of this week" className="mb-4 grid grid-cols-7 gap-1 md:hidden">
        {days.map((day) => {
          const count = (byDay.get(day) ?? []).length;
          const selected = day === selectedDay;
          return (
            <Link
              key={day}
              href={`/calendar/events?week=${weekStart}&day=${day}`}
              scroll={false}
              aria-current={selected ? "date" : undefined}
              aria-label={`${formatDayKey(day, { weekday: "long", day: "numeric", month: "long" })}, ${count} item${count === 1 ? "" : "s"}`}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl py-2 ring-1 transition-colors",
                selected ? "bg-accent-soft ring-accent/40" : "bg-surface ring-border active:bg-surface-2",
              )}
            >
              <span className="text-[10.5px] font-medium text-muted uppercase">{formatDayKey(day, { weekday: "short" }).slice(0, 2)}</span>
              <span className={cn("flex size-7 items-center justify-center rounded-full text-[14px] font-semibold tabular", day === today && "bg-accent-strong text-white")}>
                {Number(day.slice(8, 10))}
              </span>
              <span className="flex h-1.5 items-center gap-0.5">
                {Array.from({ length: Math.min(count, 3) }, (_, k) => (
                  <span key={k} className="size-1.5 rounded-full bg-accent" />
                ))}
              </span>
            </Link>
          );
        })}
      </nav>

      <section aria-label="Weekly overview" className="card mb-4 hidden overflow-x-auto p-0 md:block">
        <div className="grid min-w-[700px] grid-cols-7">
          {days.map((day, idx) => {
            const list = byDay.get(day) ?? [];
            const dayTotal = expectedTotal(list);
            const selected = day === selectedDay;
            return (
              <div key={day} className={cn("flex min-h-[260px] flex-col", idx < 6 && "border-r border-border", selected && "bg-surface-2/60")}>
                <Link
                  href={`/calendar/events?week=${weekStart}&day=${day}`}
                  scroll={false}
                  aria-current={selected ? "date" : undefined}
                  className={cn("flex items-center justify-between border-b border-border px-3 py-2.5 transition-colors hover:bg-surface-2", selected && "bg-surface-2")}
                >
                  <span>
                    <span className="block text-[11px] font-medium text-muted uppercase">{formatDayKey(day, { weekday: "short" })}</span>
                    <span className={cn("flex size-7 items-center justify-center rounded-full text-[15px] font-semibold tabular", day === today && "bg-accent-strong text-white")}>
                      {Number(day.slice(8, 10))}
                    </span>
                  </span>
                  {dayTotal > 0 && <span className="text-[11px] text-muted tabular">{formatMoney(dayTotal, currency, { decimals: dayTotal >= 100 ? 0 : 2 })}</span>}
                </Link>
                <ul className="flex flex-1 flex-col gap-1.5 p-2">
                  {list.map((i) => {
                    return (
                      <li key={i.id}>
                        <Link
                          href={i.kind === "event" ? `/calendar/events?week=${weekStart}&day=${day}&id=${i.eventId}` : i.href}
                          scroll={false}
                          className={cn("block rounded-lg border px-2 py-1.5 transition-[filter,transform] hover:brightness-110 active:translate-y-px", cellClass(i))}
                        >
                          <span className="flex items-center gap-1.5 text-[11px] text-muted tabular">
                            <ItemIcon item={i} className="size-3 shrink-0" />
                            {i.time ? `${i.time}${i.endTime ? `–${i.endTime}` : ""}` : i.continued ? "continues" : "all day"}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug font-medium">{i.title}</span>
                          {i.amount ? <span className="mt-0.5 block text-[11px] text-muted tabular">{formatMoney(i.amount, i.currency ?? currency)}</span> : null}
                        </Link>
                      </li>
                    );
                  })}
                  {list.length === 0 && <li className="px-1 pt-1 text-[11.5px] text-muted/70">Free</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <Card>
        <CardHeader
          title={`${relativeDayKey(selectedDay, today)} · ${formatDayKey(selectedDay, { weekday: "long", day: "numeric", month: "long" })}`}
          description="Daily agenda"
          action={<NewEventButton date={selectedDay} variant="ghost" size="sm">Add</NewEventButton>}
        />
        <CardBody>
          {selectedItems.length ? (
            <AgendaList items={selectedItems.map((i) => (i.kind === "event" ? { ...i, href: `/calendar/events?week=${weekStart}&day=${selectedDay}&id=${i.eventId}` } : i))} />
          ) : (
            <EmptyState title="Nothing on this day" description="Pick another day above, or add an event." className="py-8" />
          )}
        </CardBody>
      </Card>

      <EventDetailDialog key={eventId ?? "none"} data={detail} closeHref={`/calendar/events?week=${weekStart}&day=${selectedDay}`} />
    </div>
  );
}
