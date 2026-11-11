import type { DataCard } from "@/lib/ai/cards";
import { DemoBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = { positive: "text-positive", negative: "text-danger", warning: "text-warning", neutral: "text-fg" };

/** A chart or table drawn straight from the user's data, shown under an assistant answer. */
export function DataCardView({ card }: { card: DataCard }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5" data-card={card.kind}>
      <p className="mb-2.5 flex items-center gap-2 text-[12px] font-medium text-muted">
        {card.title} {card.demo && <DemoBadge />}
      </p>
      {card.kind === "stats" && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {card.items.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="truncate text-[11.5px] text-muted capitalize">{s.label}</dt>
              <dd className={cn("mt-0.5 truncate text-[15px] font-semibold tabular", TONE[s.tone ?? "neutral"])}>{s.value}</dd>
              {s.hint && <dd className="truncate text-[11.5px] text-muted">{s.hint}</dd>}
            </div>
          ))}
        </dl>
      )}
      {card.kind === "bars" && <Bars items={card.items} />}
      {card.kind === "table" && (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11.5px] text-muted">
                {card.columns.map((c) => (
                  <th key={c.key} className={cn("px-1 pb-1.5 font-medium", c.align === "right" && "text-right")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {card.rows.map((row, i) => (
                <tr key={i}>
                  {card.columns.map((c, j) => (
                    <td key={c.key} className={cn("max-w-[14rem] truncate px-1 py-1.5", c.align === "right" ? "text-right tabular whitespace-nowrap" : j === 0 ? "whitespace-nowrap text-secondary" : "text-fg")}>
                      {row[c.key] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {card.more ? <p className="px-1 pt-2 text-[11.5px] text-muted">+ {card.more} more</p> : null}
        </div>
      )}
    </div>
  );
}

function Bars({ items }: { items: { label: string; value: number; display: string; hint?: string }[] }) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 0.01);
  return (
    <ul className="space-y-2">
      {items.map((i, idx) => (
        <li key={`${i.label}${idx}`} className="grid grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-3 text-[12.5px]">
          <span className="truncate text-secondary">{i.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max((Math.abs(i.value) / max) * 100, i.value ? 2 : 0)}%` }} />
          </span>
          <span className="text-right tabular">
            <span className="font-medium text-fg">{i.display}</span>
            {i.hint && <span className="ml-1.5 text-[11.5px] text-muted">{i.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
