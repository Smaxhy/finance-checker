import Link from "next/link";
import {
  AlarmClock,
  BedDouble,
  CalendarCheck,
  CalendarClock,
  CreditCard,
  Hourglass,
  ListTodo,
  MapPin,
  Package,
  Plane,
  Receipt,
  Repeat,
  Stethoscope,
  Ticket,
  Truck,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { DemoBadge } from "@/components/ui/badge";
import { formatDate, formatMoney, formatTime, relativeDay } from "@/lib/format";
import type { Category, EmailCategory, EmailRecord, EventKind, Transaction } from "@/lib/types";
import type { UpcomingItem } from "@/lib/engines/upcoming";
import { cn } from "@/lib/utils";

export const EVENT_ICONS: Record<EventKind, LucideIcon> = {
  flight: Plane,
  hotel: BedDouble,
  restaurant: UtensilsCrossed,
  appointment: Stethoscope,
  meeting: Users,
  ticket: Ticket,
  delivery: Truck,
  payment: CreditCard,
  travel: MapPin,
  personal: CalendarCheck,
  other: CalendarCheck,
};

export const EMAIL_CATEGORY_LABEL: Record<EmailCategory, string> = {
  receipt: "Receipt",
  purchase: "Purchase",
  order: "Order",
  shipping: "Shipping",
  subscription: "Subscription",
  trial: "Free trial",
  renewal: "Renewal",
  cancellation: "Cancellation",
  bill: "Bill",
  booking: "Booking",
  travel: "Travel",
  appointment: "Appointment",
  important: "Important",
  other: "Other",
};

export const EMAIL_CATEGORY_ICON: Record<EmailCategory, LucideIcon> = {
  receipt: Receipt,
  purchase: Package,
  order: Package,
  shipping: Truck,
  subscription: Repeat,
  trial: Hourglass,
  renewal: Repeat,
  cancellation: Repeat,
  bill: CreditCard,
  booking: BedDouble,
  travel: Plane,
  appointment: Stethoscope,
  important: AlarmClock,
  other: Receipt,
};

function upcomingIcon(item: UpcomingItem): LucideIcon {
  switch (item.kind) {
    case "subscription":
      return Repeat;
    case "bill":
    case "payment_due":
      return CreditCard;
    case "trial_end":
      return Hourglass;
    case "cancellation_deadline":
      return CalendarClock;
    case "task":
      return ListTodo;
    case "event":
      return EVENT_ICONS[item.eventKind ?? "other"];
  }
}

export function UpcomingList({ items, currency = "EUR", compact = false }: { items: UpcomingItem[]; currency?: string; compact?: boolean }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const Icon = upcomingIcon(item);
        const warn = item.kind === "trial_end" || item.kind === "cancellation_deadline" || item.subtitle === "Overdue";
        return (
          <li key={item.id}>
            <Link href={item.href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2">
              <div className="w-12 shrink-0 text-center">
                <p className="text-[10.5px] font-medium tracking-wide text-muted uppercase">
                  {new Date(item.date.length === 10 ? item.date + "T12:00:00" : item.date).toLocaleDateString("en-BE", { month: "short" })}
                </p>
                <p className="text-[16px] leading-tight font-semibold tabular">
                  {new Date(item.date.length === 10 ? item.date + "T12:00:00" : item.date).getDate()}
                </p>
              </div>
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg border",
                  warn ? "border-warning/30 bg-warning-soft text-warning" : "border-border bg-surface-2 text-secondary",
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                  <span className="truncate">{item.title}</span>
                  {item.isDemo && <DemoBadge />}
                </p>
                {!compact && (
                  <p className="truncate text-[12px] text-muted">
                    {relativeDay(item.date)}
                    {!item.allDay && item.kind !== "task" ? ` · ${formatTime(item.date)}` : ""}
                    {item.subtitle ? ` · ${item.subtitle}` : ""}
                  </p>
                )}
              </div>
              {item.amount ? <span className="tabular text-[13px] font-medium">{formatMoney(item.amount, item.currency ?? currency)}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function TransactionMiniList({ rows, categories }: { rows: Transaction[]; categories: Map<string, Category> }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((t) => {
        const cat = categories.get(t.category_id ?? "other");
        const positive = t.amount > 0;
        return (
          <li key={t.id}>
            <Link href={`/finances/transactions?q=${encodeURIComponent(t.merchant ?? "")}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
              <CategoryIcon icon={cat?.icon} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                  <span className="truncate">{t.merchant ?? t.counterparty_name ?? t.description ?? "Transaction"}</span>
                  {t.is_demo && <DemoBadge />}
                </p>
                <p className="truncate text-[12px] text-muted">
                  {formatDate(t.booked_at, "short")} · {t.kind === "transfer" ? "Own-account transfer" : (cat?.name ?? "Uncategorised")}
                </p>
              </div>
              <span className={cn("tabular text-[13px] font-medium", positive && t.kind !== "transfer" && "text-positive", t.kind === "transfer" && "text-muted")}>
                {formatMoney(t.amount, t.currency, { sign: true })}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function EmailMiniList({ rows }: { rows: EmailRecord[] }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((e) => {
        const Icon = EMAIL_CATEGORY_ICON[e.category];
        return (
          <li key={e.id}>
            <Link href={`/emails?id=${e.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-secondary">
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                  <span className="truncate">{e.subject ?? "(no subject)"}</span>
                  {e.is_demo && <DemoBadge />}
                </p>
                <p className="truncate text-[12px] text-muted">
                  {e.merchant ?? e.from_name ?? e.from_email} · {EMAIL_CATEGORY_LABEL[e.category]} · {relativeDay(e.received_at)}
                </p>
              </div>
              {e.amount ? <span className="tabular text-[13px] font-medium">{formatMoney(Number(e.amount), e.currency ?? "EUR")}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
