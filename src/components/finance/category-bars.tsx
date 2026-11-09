import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import { formatMoney } from "@/lib/format";

export interface CategoryBarItem {
  id: string;
  name: string;
  icon: string;
  spent: number;
  txCount: number;
  budget?: number | null;
}

/**
 * Ranked horizontal bars. Identity is carried by the label + icon (not by
 * colour), so any number of categories stays readable; the bar is one hue.
 */
export function CategoryBars({
  items,
  currency = "EUR",
  hrefFor,
  limit,
}: {
  items: CategoryBarItem[];
  currency?: string;
  hrefFor: (id: string) => string;
  limit?: number;
}) {
  const shown = limit ? items.slice(0, limit) : items;
  const max = Math.max(...shown.map((i) => Math.max(i.spent, i.budget ?? 0)), 1);
  const total = items.reduce((a, i) => a + i.spent, 0);
  return (
    <ul className="space-y-1">
      {shown.map((item) => (
        <li key={item.id}>
          <Link href={hrefFor(item.id)} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2">
            <CategoryIcon icon={item.icon} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] text-fg">{item.name}</span>
                <span className="tabular text-[13px] font-medium">{formatMoney(item.spent, currency)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-[var(--chart-spend)] transition-[width] duration-700 ease-out group-hover:brightness-110"
                    style={{ width: `${(item.spent / max) * 100}%` }}
                  />
                  {item.budget ? <div className="absolute inset-y-0 w-px bg-fg/60" style={{ left: `${Math.min(100, (item.budget / max) * 100)}%` }} title="Budget" /> : null}
                </div>
                <span className="w-9 text-right text-[11px] text-muted tabular">{total > 0 ? Math.round((item.spent / total) * 100) : 0}%</span>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
