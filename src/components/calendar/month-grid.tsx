"use client";
import { useState } from "react";
import { CalendarPlus, CalendarX2 } from "lucide-react";
import type { CalItem } from "@/lib/calendar/items";
import { formatDayKey, relativeDayKey } from "@/lib/calendar/time";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AgendaList, isMoney, isWarning } from "./agenda";
import { EventFormDialog, emptyEvent } from "./event-form";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function chipClass(item: CalItem) {
  if (isWarning(item)) return "bg-warning-soft text-warning";
  if (item.kind === "event") return cn("bg-accent-soft text-accent-text", item.continued && "opacity-60", item.status === "cancelled" && "line-through opacity-50");
  if (item.kind === "task") return "bg-transparent text-muted ring-1 ring-inset ring-border";
  return "bg-surface-3 text-secondary";
}

function sortForCell(items: CalItem[]) {
  const rank = (i: CalItem) => (i.kind === "event" ? 0 : isWarning(i) ? 1 : isMoney(i) ? 2 : 3);
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.time ?? "").localeCompare(b.time ?? ""));
}

export function MonthGrid({
  month,
  days,
  itemsByDay,
  todayKey,
  initialSelected,
  currency,
}: {
  month: string;
  days: string[];
  itemsByDay: Record<string, CalItem[]>;
  todayKey: string;
  initialSelected: string;
  currency: string;
}) {
  const [selected, setSelected] = useState(initialSelected);
  const [dialogOpen, setDialogOpen] = useState(false);
  const selectedItems = itemsByDay[selected] ?? [];
  const selectedTotal = selectedItems.reduce((a, i) => a + (i.isExpense && i.amount ? i.amount : 0), 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="card overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b border-border bg-surface-2/40">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={cn("px-2 py-2 text-[11.5px] font-medium text-muted", i >= 5 && "text-muted/80")}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7" role="grid" aria-label="Month calendar">
          {days.map((day, idx) => {
            const inMonth = day.startsWith(month);
            const items = sortForCell(itemsByDay[day] ?? []);
            const money = items.reduce((a, i) => a + (i.isExpense && i.amount ? i.amount : 0), 0);
            const isToday = day === todayKey;
            const isSelected = day === selected;
            const shown = items.slice(0, 3);
            const rest = items.length - shown.length;
            return (
              <button
                key={day}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-label={`${formatDayKey(day, { weekday: "long", day: "numeric", month: "long" })}, ${items.length} item${items.length === 1 ? "" : "s"}`}
                onClick={() => setSelected(day)}
                onDoubleClick={() => {
                  setSelected(day);
                  setDialogOpen(true);
                }}
                className={cn(
                  "group relative flex min-h-[92px] flex-col gap-1 border-border p-1.5 text-left transition-colors md:min-h-[112px] md:p-2",
                  idx % 7 !== 6 && "border-r",
                  idx < 35 && "border-b",
                  inMonth ? "bg-surface" : "bg-bg-subtle/60",
                  isSelected ? "bg-surface-2 ring-1 ring-accent/50 ring-inset" : "hover:bg-surface-2/70",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-[12px] tabular",
                      isToday ? "bg-accent-strong font-semibold text-white" : inMonth ? "text-fg" : "text-muted/70",
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                  {money > 0 && (
                    <span className="hidden truncate text-[10.5px] text-muted tabular sm:block" title="Expected payments">
                      {formatMoney(money, currency, { decimals: money >= 100 ? 0 : 2 })}
                    </span>
                  )}
                </div>
                <div className="hidden min-w-0 flex-col gap-0.5 md:flex">
                  {shown.map((i) => (
                    <span key={i.id} className={cn("truncate rounded px-1.5 py-[1px] text-[11px] leading-[16px]", chipClass(i))}>
                      {i.time && i.kind === "event" ? <span className="mr-1 tabular opacity-80">{i.time}</span> : null}
                      {i.title}
                    </span>
                  ))}
                  {rest > 0 && <span className="px-1.5 text-[10.5px] text-muted">+{rest} more</span>}
                </div>
                {/* compact dots on small screens */}
                <div className="flex flex-wrap gap-0.5 md:hidden">
                  {items.slice(0, 4).map((i) => (
                    <span key={i.id} className={cn("size-1.5 rounded-full", i.kind === "event" ? "bg-accent" : isWarning(i) ? "bg-warning" : "bg-muted")} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="card flex h-fit flex-col p-0 xl:sticky xl:top-20" aria-label="Day agenda">
        <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <p className="text-[11.5px] font-medium text-muted uppercase">{relativeDayKey(selected, todayKey)}</p>
            <p className="text-[14px] font-semibold">{formatDayKey(selected, { weekday: "long", day: "numeric", month: "long" })}</p>
            {selectedTotal > 0 && <p className="mt-0.5 text-[12px] text-muted">{formatMoney(selectedTotal, currency)} expected</p>}
          </div>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Add event on this day"
            title="Add event on this day"
          >
            <CalendarPlus className="size-4" />
          </button>
        </div>
        <div className="max-h-[560px] overflow-y-auto px-4 py-2">
          {selectedItems.length ? (
            <AgendaList items={selectedItems} />
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <CalendarX2 className="size-5 text-muted" />
              <p className="mt-2 text-[13px] font-medium">Nothing planned</p>
              <p className="mt-0.5 text-[12px] text-muted">Double-click a day or use + to add an event.</p>
            </div>
          )}
        </div>
      </aside>

      <EventFormDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={emptyEvent(selected)} />
    </div>
  );
}
