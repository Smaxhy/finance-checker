import Link from "next/link";
import { CalendarRange, CreditCard, Hourglass, Plane } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/core";
import { expectedTotal, loadCalendarItems, type CalItem } from "@/lib/calendar/items";
import { addDaysKey, dayKeyInTz, formatDayKey, relativeDayKey, startOfWeekKey } from "@/lib/calendar/time";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, StatTile } from "@/components/ui/misc";
import { DemoBadge } from "@/components/ui/badge";
import { CalendarTabs } from "@/components/calendar/calendar-tabs";
import { AgendaRow, isMoney } from "@/components/calendar/agenda";
import { NewEventButton } from "@/components/calendar/event-form";

export const metadata = { title: "Upcoming" };

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "payments", label: "Payments" },
  { key: "events", label: "Events" },
  { key: "tasks", label: "Tasks" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function matches(item: CalItem, f: FilterKey) {
  if (f === "payments") return isMoney(item) || item.kind === "trial_end" || item.isExpense;
  if (f === "events") return item.kind === "event";
  if (f === "tasks") return item.kind === "task";
  return true;
}

function weekLabel(weekStart: string, thisWeek: string) {
  if (weekStart === thisWeek) return "This week";
  if (weekStart === addDaysKey(thisWeek, 7)) return "Next week";
  return `Week of ${formatDayKey(weekStart, { day: "numeric", month: "short" })}`;
}

export default async function UpcomingPage({ searchParams }: PageProps<"/calendar/upcoming">) {
  const sp = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === sp.show) ? (sp.show as FilterKey) : "all";
  const { supabase, user } = await requireUser();
  const profile = await getProfile();
  const tz = profile?.timezone ?? "Europe/Brussels";
  const currency = profile?.base_currency ?? "EUR";
  const today = dayKeyInTz(new Date(), tz);
  const end = addDaysKey(today, 59);

  const all = (await loadCalendarItems(supabase, user.id, today, end, tz)).filter((i) => !i.continued && i.status !== "cancelled");
  const items = all.filter((i) => matches(i, filter));

  const within = (days: number) => all.filter((i) => i.day <= addDaysKey(today, days - 1));
  const next7 = expectedTotal(within(7));
  const next30 = expectedTotal(within(30));
  const next60 = expectedTotal(all);
  const events30 = within(30).filter((i) => i.kind === "event").length;
  const obligations = all.filter((i) => i.kind === "event" && i.amount);
  const biggest = all
    .filter((i) => i.isExpense && i.amount)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, 5);
  const trials = all.filter((i) => i.kind === "trial_end" || i.kind === "cancellation_deadline");

  // week -> day -> items
  const thisWeek = startOfWeekKey(today);
  const weeks = new Map<string, Map<string, CalItem[]>>();
  for (const i of items) {
    const w = startOfWeekKey(i.day);
    const days = weeks.get(w) ?? new Map<string, CalItem[]>();
    const list = days.get(i.day) ?? [];
    list.push(i);
    days.set(i.day, list);
    weeks.set(w, days);
  }

  return (
    <div>
      <PageHeader
        title="Upcoming"
        description="The next 60 days: events, renewals, bills, trial ends, booking balances and tasks - with what you can expect to pay."
        actions={<NewEventButton date={today} variant="secondary" />}
      >
        <CalendarTabs active="/calendar/upcoming" />
      </PageHeader>

      <section className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Expected payments">
        <StatTile label="Expected in 7 days" icon={CreditCard} value={formatMoney(next7, currency)} hint="Items with a known amount" />
        <StatTile label="Expected in 30 days" icon={CreditCard} value={formatMoney(next30, currency)} hint={`${within(30).filter((i) => i.isExpense && i.amount).length} payments`} />
        <StatTile label="Expected in 60 days" icon={CreditCard} value={formatMoney(next60, currency)} hint={`${all.filter((i) => i.isExpense && i.amount).length} payments`} />
        <StatTile label="Events in 30 days" icon={CalendarRange} value={String(events30)} hint={`${all.filter((i) => i.kind === "task").length} open tasks`} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={f.key === "all" ? "/calendar/upcoming" : `/calendar/upcoming?show=${f.key}`}
                role="tab"
                aria-selected={filter === f.key}
                scroll={false}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[12.5px] font-medium ring-1 transition-colors ring-inset",
                  filter === f.key ? "bg-surface-3 text-fg ring-border-strong" : "text-muted ring-border hover:text-secondary",
                )}
              >
                {f.label}
              </Link>
            ))}
          </div>

          {items.length === 0 ? (
            <Card>
              <EmptyState icon={CalendarRange} title="Nothing coming up" description="Renewals, bills, bookings, events and tasks for the next 60 days will appear here." />
            </Card>
          ) : (
            <div className="space-y-5">
              {[...weeks.entries()].map(([week, days]) => {
                const weekItems = [...days.values()].flat();
                const total = expectedTotal(weekItems);
                return (
                  <section key={week} aria-label={weekLabel(week, thisWeek)}>
                    <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                      <h2 className="text-[13px] font-semibold">
                        {weekLabel(week, thisWeek)}
                        <span className="ml-2 font-normal text-muted">
                          {formatDayKey(week, { day: "numeric", month: "short" })} – {formatDayKey(addDaysKey(week, 6), { day: "numeric", month: "short" })}
                        </span>
                      </h2>
                      <p className="text-[12px] text-muted tabular">
                        {weekItems.length} item{weekItems.length === 1 ? "" : "s"}
                        {total > 0 ? (
                          <>
                            {" · "}
                            <span className="font-medium text-secondary">{formatMoney(total, currency)}</span> expected
                          </>
                        ) : null}
                      </p>
                    </div>
                    <Card className="divide-y divide-border">
                      {[...days.entries()].map(([day, list]) => (
                        <div key={day} className="grid gap-x-4 px-4 py-2 sm:grid-cols-[120px_1fr]">
                          <div className="pt-2.5">
                            <p className={cn("text-[12.5px] font-medium", day === today ? "text-accent-text" : "text-secondary")}>{relativeDayKey(day, today)}</p>
                            {relativeDayKey(day, today) !== formatDayKey(day, { weekday: "short", day: "numeric", month: "short" }) && (
                              <p className="text-[11.5px] text-muted">{formatDayKey(day, { weekday: "short", day: "numeric", month: "short" })}</p>
                            )}
                          </div>
                          <ul className="divide-y divide-border">
                            {list.map((i) => (
                              <AgendaRow key={i.id} item={i} />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </Card>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Booking obligations" description="Balances still to pay for trips and reservations" />
            <CardBody>
              {obligations.length ? (
                <ul className="space-y-2.5">
                  {obligations.map((o) => (
                    <li key={o.id}>
                      <Link href={o.href} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2">
                        <Plane className="mt-0.5 size-4 shrink-0 text-muted" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-[13px] font-medium">
                            <span className="truncate">{o.title}</span>
                            {o.isDemo && <DemoBadge />}
                          </p>
                          <p className="text-[12px] text-muted">
                            {formatMoney(o.amount, o.currency ?? currency)} {o.amountLabel ?? "due"} · {relativeDayKey(o.day, today).toLowerCase()}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-muted">No open balances on bookings.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Largest upcoming payments" />
            <CardBody>
              {biggest.length ? (
                <ul className="space-y-2">
                  {biggest.map((b) => (
                    <li key={b.id}>
                      <Link href={b.href} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px]">{b.title}</span>
                          <span className="block text-[11.5px] text-muted">{formatDayKey(b.day, { weekday: "short", day: "numeric", month: "short" })}</span>
                        </span>
                        <span className="text-[13px] font-medium tabular">{formatMoney(b.amount, b.currency ?? currency)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-muted">No payments with known amounts.</p>
              )}
            </CardBody>
          </Card>

          {trials.length > 0 && (
            <Card>
              <CardHeader title="Decide before" description="Trials converting to paid plans and cancellation deadlines" />
              <CardBody>
                <ul className="space-y-2">
                  {trials.map((t) => (
                    <li key={t.id}>
                      <Link href={t.href} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2">
                        <Hourglass className="mt-0.5 size-4 shrink-0 text-warning" />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium">{t.title}</span>
                          <span className="block text-[12px] text-muted">
                            {relativeDayKey(t.day, today)}
                            {t.amount ? ` · then ${formatMoney(t.amount, t.currency ?? currency)}` : ""}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          <p className="px-1 text-[11.5px] text-muted">
            Recurring charges are projected from each subscription&apos;s next payment date and billing cycle. Totals only include items with a known amount.
          </p>
        </aside>
      </div>
    </div>
  );
}
