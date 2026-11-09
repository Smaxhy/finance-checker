import Link from "next/link";
import { CalendarClock, CreditCard, Hourglass, ListTodo, Repeat, type LucideIcon } from "lucide-react";
import { EVENT_ICONS } from "@/components/lists/lists";
import { DemoBadge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import type { CalItem } from "@/lib/calendar/items";
import { cn } from "@/lib/utils";

const KIND_ICONS: Record<Exclude<CalItem["kind"], "event">, LucideIcon> = {
  subscription: Repeat,
  bill: CreditCard,
  payment_due: CreditCard,
  trial_end: Hourglass,
  cancellation_deadline: CalendarClock,
  task: ListTodo,
};

export function ItemIcon({ item, className }: { item: Pick<CalItem, "kind" | "eventKind">; className?: string }) {
  const Icon = item.kind === "event" ? EVENT_ICONS[item.eventKind ?? "other"] : KIND_ICONS[item.kind];
  return <Icon className={className} />;
}

export function isWarning(item: Pick<CalItem, "kind" | "subtitle">) {
  return item.kind === "trial_end" || item.kind === "cancellation_deadline" || item.subtitle === "Overdue";
}

export function isMoney(item: Pick<CalItem, "kind">) {
  return item.kind === "subscription" || item.kind === "bill" || item.kind === "payment_due";
}

export const KIND_LABEL: Record<CalItem["kind"], string> = {
  event: "Event",
  subscription: "Renewal",
  bill: "Bill",
  payment_due: "Payment due",
  trial_end: "Trial ends",
  cancellation_deadline: "Cancellation deadline",
  task: "Task",
};

export function AgendaRow({ item, showDay, dayLabel }: { item: CalItem; showDay?: boolean; dayLabel?: string }) {
  const warn = isWarning(item);
  const cancelled = item.status === "cancelled";
  return (
    <li>
      <Link
        href={item.href}
        scroll={false}
        className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2"
      >
        <div className="w-12 shrink-0 text-right text-[12px] leading-tight tabular text-muted">
          {showDay && dayLabel ? <span className="block text-[11px] text-muted">{dayLabel}</span> : null}
          {item.time ? (
            <>
              <span className="block font-medium text-secondary">{item.time}</span>
              {item.endTime ? <span className="block">{item.endTime}</span> : null}
            </>
          ) : (
            <span className="block">{item.continued ? "cont." : "all day"}</span>
          )}
        </div>
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg border",
            warn
              ? "border-warning/30 bg-warning-soft text-warning"
              : item.kind === "event"
                ? "border-accent/25 bg-accent-soft text-accent-text"
                : "border-border bg-surface-2 text-secondary",
          )}
        >
          <ItemIcon item={item} className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("flex items-center gap-1.5 text-[13px] font-medium", cancelled && "text-muted line-through")}>
            <span className="truncate">{item.title}</span>
            {item.isDemo && <DemoBadge />}
          </p>
          <p className="truncate text-[12px] text-muted">
            {cancelled ? "Cancelled · " : ""}
            {item.continued ? "Continues · " : ""}
            {item.kind !== "event" ? `${KIND_LABEL[item.kind]}${item.subtitle ? " · " : ""}` : ""}
            {item.subtitle ?? ""}
          </p>
        </div>
        {item.amount ? (
          <span className="shrink-0 text-right">
            <span className="block text-[13px] font-medium tabular">{formatMoney(item.amount, item.currency ?? "EUR")}</span>
            {item.amountLabel ? <span className="block text-[11px] text-muted">{item.amountLabel}</span> : null}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export function AgendaList({ items, className }: { items: CalItem[]; className?: string }) {
  return (
    <ul className={cn("divide-y divide-border", className)}>
      {items.map((i) => (
        <AgendaRow key={i.id} item={i} />
      ))}
    </ul>
  );
}
