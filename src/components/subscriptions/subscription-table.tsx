"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import type { Subscription } from "@/lib/types";
import { monthlyEquivalent, yearlyEquivalent } from "@/lib/finance/recurring";
import { formatDate, formatMoney } from "@/lib/format";
import { daysBetween, toISODate } from "@/lib/dates";
import { CYCLE_UNIT, isCharging } from "@/lib/subscriptions/helpers";
import { CategoryIcon } from "@/components/category-icon";
import { DemoBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SourceLabel, StatusBadge } from "./status-badge";

function inDays(date: string): string {
  const n = daysBetween(toISODate(new Date()), date);
  return n === 0 ? "today" : n === 1 ? "tomorrow" : n > 0 ? `in ${n} days` : `${-n} days ago`;
}

type SortKey = "name" | "monthly" | "next" | "last" | "status";

const STATUS_ORDER: Record<string, number> = { trial: 0, cancellation_pending: 1, active: 2, paused: 3, expired: 4, cancelled: 5 };

export function SubscriptionTable({
  rows,
  categoryIcons,
  emptyMessage = "Nothing here yet.",
  searchable = true,
  defaultSort = "monthly",
}: {
  rows: Subscription[];
  categoryIcons: Record<string, string>;
  emptyMessage?: string;
  searchable?: boolean;
  defaultSort?: SortKey;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: defaultSort, dir: defaultSort === "monthly" ? -1 : 1 });
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => `${r.name} ${r.provider ?? ""} ${r.payment_method ?? ""}`.toLowerCase().includes(q)) : rows;
    const value = (r: Subscription): string | number => {
      switch (sort.key) {
        case "name":
          return r.name.toLowerCase();
        case "monthly":
          return monthlyEquivalent(r.amount, r.billing_cycle);
        case "next":
          return (r.status === "trial" ? r.trial_ends_at : isCharging(r) ? r.next_payment_date : null) ?? "9999";
        case "last":
          return r.last_payment_date ?? "0000";
        case "status":
          return STATUS_ORDER[r.status] ?? 9;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir || a.name.localeCompare(b.name);
    });
  }, [rows, sort, query]);

  const header = (key: SortKey, label: string, className?: string) => (
    <th className={className} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button
        className={cn("inline-flex items-center gap-1 transition-colors hover:text-fg", sort.key === key && "text-secondary")}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "monthly" ? -1 : 1 }))}
      >
        {label}
        {sort.key === key ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
      </button>
    </th>
  );

  return (
    <div>
      {searchable && rows.length > 6 && (
        <div className="relative mb-3 max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name or payment method…" className="pl-8" aria-label="Filter subscriptions" />
        </div>
      )}
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">{query ? "No subscriptions match that filter." : emptyMessage}</p>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="data-table min-w-[880px]">
            <thead>
              <tr>
                {header("name", "Subscription", "pl-5")}
                <th className="text-right">Price</th>
                {header("monthly", "Per month · year", "text-right")}
                {header("next", "Next payment")}
                {header("last", "Last payment")}
                <th>Payment method</th>
                {header("status", "Status · source", "pr-5")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const monthly = monthlyEquivalent(s.amount, s.billing_cycle);
                const next = s.status === "trial" ? s.trial_ends_at : isCharging(s) ? s.next_payment_date : null;
                const overdue = next !== null && isCharging(s) && next < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={s.id} className="cursor-pointer" onClick={() => router.push(`/subscriptions/${s.id}`)}>
                    <td className="pl-5">
                      <div className="flex items-center gap-3">
                        <CategoryIcon icon={categoryIcons[s.category_id ?? "subscriptions"] ?? "repeat"} />
                        <div className="min-w-0">
                          <Link href={`/subscriptions/${s.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-[13px] font-medium hover:underline">
                            <span className="truncate">{s.name}</span>
                            {s.is_demo && <DemoBadge />}
                          </Link>
                          {s.provider && s.provider !== s.name ? <p className="truncate text-[12px] text-muted">{s.provider}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <span className="tabular text-[13px] font-medium">{formatMoney(s.amount, s.currency)}</span>
                      <span className="text-[12px] text-muted"> / {CYCLE_UNIT[s.billing_cycle]}</span>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <p className="text-[13px] tabular">{formatMoney(monthly, s.currency)}</p>
                      <p className="text-[12px] text-muted tabular">{formatMoney(yearlyEquivalent(s.amount, s.billing_cycle), s.currency, { decimals: 0 })} / yr</p>
                    </td>
                    <td className="whitespace-nowrap">
                      {next ? (
                        <>
                          <p className={cn("text-[13px]", overdue && "text-warning")}>{formatDate(next, "medium")}</p>
                          <p className="text-[12px] text-muted">{overdue ? "expected - not seen yet" : s.status === "trial" ? `trial ends ${inDays(next)}` : inDays(next)}</p>
                        </>
                      ) : (
                        <span className="text-[13px] text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {s.last_payment_date ? (
                        <>
                          <p className="text-[13px]">{formatDate(s.last_payment_date, "medium")}</p>
                          {s.last_payment_amount ? <p className="text-[12px] text-muted tabular">{formatMoney(s.last_payment_amount, s.currency)}</p> : null}
                        </>
                      ) : (
                        <span className="text-[13px] text-muted">—</span>
                      )}
                    </td>
                    <td className="max-w-40 truncate text-[12.5px] text-secondary">{s.payment_method ?? <span className="text-muted">Unknown</span>}</td>
                    <td className="pr-5">
                      <StatusBadge status={s.status} dismissed={s.dismissed} />
                      <div className="mt-0.5">
                        <SourceLabel s={s} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
