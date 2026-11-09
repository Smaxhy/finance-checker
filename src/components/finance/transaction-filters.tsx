"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface FilterOption {
  value: string;
  label: string;
}

export const PERIODS: FilterOption[] = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "3m", label: "Last 3 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "ytd", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

export function TransactionFilters({
  categories,
  accounts,
  showKind = true,
}: {
  categories: FilterOption[];
  accounts: FilterOption[];
  showKind?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounced search.
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => update({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const period = params.get("period") ?? (params.get("from") || params.get("to") ? "custom" : "3m");
  const active = ["q", "category", "kind", "account", "period", "from", "to"].some((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search merchant, description, notes…" className="pl-8" aria-label="Search transactions" />
      </div>
      <Select value={period} onChange={(e) => update({ period: e.target.value, ...(e.target.value !== "custom" ? { from: null, to: null } : {}) })} className="w-40" aria-label="Period">
        {PERIODS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      {period === "custom" && (
        <>
          <Input type="date" value={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value, period: "custom" })} className="w-36" aria-label="From" />
          <Input type="date" value={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value, period: "custom" })} className="w-36" aria-label="To" />
        </>
      )}
      <Select value={params.get("category") ?? ""} onChange={(e) => update({ category: e.target.value })} className="w-48" aria-label="Category">
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
      {showKind && (
        <Select value={params.get("kind") ?? ""} onChange={(e) => update({ kind: e.target.value })} className="w-36" aria-label="Type">
          <option value="">All types</option>
          <option value="spending">Spending</option>
          <option value="income">Income</option>
          <option value="refund">Refunds</option>
          <option value="transfer">Own transfers</option>
          <option value="withdrawal">Cash</option>
        </Select>
      )}
      {accounts.length > 1 && (
        <Select value={params.get("account") ?? ""} onChange={(e) => update({ account: e.target.value })} className="w-44" aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
      )}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            start(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X /> Clear
        </Button>
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted" aria-label="Loading" />}
    </div>
  );
}
