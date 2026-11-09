import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/core";
import { integrationStatus } from "@/lib/env";
import { calendarConnectionState, expectedTotal, groupByDay, loadCalendarItems } from "@/lib/calendar/items";
import { addMonthsToMonthKey, dayKeyInTz, formatMonthKey, monthGridKeys } from "@/lib/calendar/time";
import { formatMoney } from "@/lib/format";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { CalendarTabs } from "@/components/calendar/calendar-tabs";
import { MonthGrid } from "@/components/calendar/month-grid";
import { NewEventButton } from "@/components/calendar/event-form";
import { CalendarSetupNotice } from "./setup-notice";

export const metadata = { title: "Calendar" };

export default async function CalendarMonthPage({ searchParams }: PageProps<"/calendar">) {
  const sp = await searchParams;
  const { supabase, user } = await requireUser();
  const profile = await getProfile();
  const tz = profile?.timezone ?? "Europe/Brussels";
  const currency = profile?.base_currency ?? "EUR";
  const todayKey = dayKeyInTz(new Date(), tz);
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayKey.slice(0, 7);
  const days = monthGridKeys(month);

  const [items, connection] = await Promise.all([loadCalendarItems(supabase, user.id, days[0], days[days.length - 1], tz), calendarConnectionState(supabase)]);
  const byDay = Object.fromEntries(groupByDay(items));
  const inMonth = items.filter((i) => i.day.startsWith(month));
  const monthExpected = expectedTotal(inMonth.filter((i) => i.day >= todayKey));
  const eventCount = inMonth.filter((i) => i.kind === "event" && !i.continued).length;
  const initialSelected = todayKey.startsWith(month) ? todayKey : `${month}-01`;

  return (
    <div>
      <PageHeader
        title="Calendar"
        description={
          <>
            {eventCount} event{eventCount === 1 ? "" : "s"} in {formatMonthKey(month)}
            {monthExpected > 0 ? ` · ${formatMoney(monthExpected, currency)} in expected payments still to come` : ""}
          </>
        }
        actions={
          <>
            <div className="flex items-center rounded-lg border border-border bg-surface">
              <ButtonLink href={`/calendar?month=${addMonthsToMonthKey(month, -1)}`} variant="ghost" size="icon" aria-label="Previous month" scroll={false}>
                <ChevronLeft />
              </ButtonLink>
              <span className="min-w-32 px-1 text-center text-[13px] font-medium">{formatMonthKey(month)}</span>
              <ButtonLink href={`/calendar?month=${addMonthsToMonthKey(month, 1)}`} variant="ghost" size="icon" aria-label="Next month" scroll={false}>
                <ChevronRight />
              </ButtonLink>
            </div>
            {month !== todayKey.slice(0, 7) && (
              <ButtonLink href="/calendar" variant="secondary">
                Today
              </ButtonLink>
            )}
            <NewEventButton date={initialSelected} autoOpen={sp.new === "event"} />
          </>
        }
      >
        <CalendarTabs active="/calendar" />
      </PageHeader>

      <CalendarSetupNotice state={connection} googleConfigured={integrationStatus().google.configured} missing={integrationStatus().google.missing} />

      <MonthGrid key={month} month={month} days={days} itemsByDay={byDay} todayKey={todayKey} initialSelected={initialSelected} currency={currency} />

      <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-accent-soft ring-1 ring-accent/30" /> Events
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-surface-3" /> Renewals & bills
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-warning-soft ring-1 ring-warning/30" /> Trials & deadlines
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm ring-1 ring-border" /> Tasks
        </span>
        <span className="ml-auto hidden sm:inline">Double-click a day to add an event</span>
      </div>
    </div>
  );
}
