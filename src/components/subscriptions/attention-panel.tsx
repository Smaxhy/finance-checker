import Link from "next/link";
import { BellRing, CircleCheck, Copy, Eye, Hourglass, OctagonAlert, ScanSearch, TrendingUp, TriangleAlert, type LucideIcon } from "lucide-react";
import type { AttentionItem, AttentionKind } from "@/lib/subscriptions/helpers";
import { cn } from "@/lib/utils";

const ICONS: Record<AttentionKind, LucideIcon> = {
  charged_after_cancel: OctagonAlert,
  trial_ending: Hourglass,
  price_increase: TrendingUp,
  duplicate: Copy,
  cancellation_pending: BellRing,
  overdue: TriangleAlert,
  review: ScanSearch,
  forgotten: Eye,
};

const SEVERITY_CLASS = {
  critical: "border-danger/30 bg-danger-soft text-danger",
  warning: "border-warning/25 bg-warning-soft text-warning",
  info: "border-border bg-surface-2 text-secondary",
} as const;

export function AttentionPanel({ items, limit }: { items: AttentionItem[]; limit?: number }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 py-4 text-[13px] text-muted">
        <CircleCheck className="size-4 text-positive" /> Nothing needs your attention right now.
      </div>
    );
  }
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <ul className="divide-y divide-border">
      {shown.map((item, i) => {
        const Icon = ICONS[item.kind];
        return (
          <li key={`${item.kind}-${i}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border", SEVERITY_CLASS[item.severity])}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug font-medium">{item.title}</p>
              <p className="mt-0.5 text-[12.5px] text-muted">{item.detail}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {item.subscriptions.slice(0, 8).map((s) => (
                  <Link
                    key={s.id}
                    href={`/subscriptions/${s.id}`}
                    className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-secondary transition-colors hover:border-border-strong hover:text-fg"
                  >
                    {s.name}
                  </Link>
                ))}
                {item.subscriptions.length > 8 && <span className="px-1 text-[11.5px] text-muted">+{item.subscriptions.length - 8} more</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
