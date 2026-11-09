import Link from "next/link";
import { ArrowUpRight, Info, TrendingDown, TriangleAlert } from "lucide-react";
import type { Insight } from "@/lib/engines/insights";
import { cn } from "@/lib/utils";

const toneIcon = { neutral: Info, positive: TrendingDown, warning: TriangleAlert } as const;
const toneClass = {
  neutral: "border-border bg-surface-2 text-secondary",
  positive: "border-positive/25 bg-positive-soft text-positive",
  warning: "border-warning/25 bg-warning-soft text-warning",
} as const;

export function InsightList({ insights, compact = false }: { insights: Insight[]; compact?: boolean }) {
  return (
    <ul className={cn(compact ? "space-y-1" : "grid gap-3 md:grid-cols-2")}>
      {insights.map((i) => {
        const Icon = toneIcon[i.tone];
        const body = (
          <div className={cn("group flex gap-3 rounded-lg transition-colors", compact ? "-mx-2 px-2 py-2 hover:bg-surface-2" : "card h-full p-4 hover:border-border-strong")}>
            <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border", toneClass[i.tone])}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug font-medium">{i.title}</p>
              {i.detail && <p className={cn("mt-0.5 text-[12.5px] text-muted", compact && "line-clamp-2")}>{i.detail}</p>}
            </div>
            {i.href && <ArrowUpRight className="size-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />}
          </div>
        );
        return <li key={i.id}>{i.href ? <Link href={i.href}>{body}</Link> : body}</li>;
      })}
    </ul>
  );
}
