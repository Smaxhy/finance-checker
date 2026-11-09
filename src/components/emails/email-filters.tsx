"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EMAIL_CATEGORY_LABEL } from "@/components/lists/lists";
import type { EmailCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const CATEGORY_OPTIONS = Object.entries(EMAIL_CATEGORY_LABEL) as [EmailCategory, string][];

export function EmailFilters({ suggestions }: { suggestions: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [showMore, setShowMore] = useState(Boolean(params.get("category") || params.get("from") || params.get("to")));

  // Keep the input in sync when the URL changes (back/forward, suggestion chips).
  const urlQ = params.get("q") ?? "";
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ);
    setQ(urlQ);
  }

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    next.delete("id");
    start(() => router.push(`${pathname}${next.size ? `?${next}` : ""}`));
  };

  const hasFilters = Boolean(params.get("q") || params.get("category") || params.get("from") || params.get("to"));

  return (
    <div className="space-y-2.5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          push({ q: q.trim() || null });
        }}
        className="flex flex-wrap items-center gap-2"
        role="search"
      >
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a store, subject, order number… e.g. “amazon”"
            className="h-10 pl-9 text-[13.5px]"
            aria-label="Search emails"
          />
          {pending && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" />}
        </div>
        <Button type="submit" variant="primary" size="lg">
          Search
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => setShowMore((s) => !s)} aria-expanded={showMore}>
          Filters
        </Button>
        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => {
              setQ("");
              push({ q: null, category: null, from: null, to: null });
            }}
          >
            <X /> Clear
          </Button>
        )}
      </form>

      {showMore && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface/60 p-3 animate-fade-in">
          <label className="text-[12px] text-muted">
            Category
            <Select className="mt-1 w-44" value={params.get("category") ?? ""} onChange={(e) => push({ category: e.target.value || null })}>
              <option value="">Any category</option>
              {CATEGORY_OPTIONS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-[12px] text-muted">
            From
            <Input type="date" className="mt-1 w-40" value={params.get("from") ?? ""} onChange={(e) => push({ from: e.target.value || null })} />
          </label>
          <label className="text-[12px] text-muted">
            To
            <Input type="date" className="mt-1 w-40" value={params.get("to") ?? ""} onChange={(e) => push({ to: e.target.value || null })} />
          </label>
        </div>
      )}

      {suggestions.length > 0 && !params.get("q") && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <span>Try:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQ(s);
                push({ q: s });
              }}
              className={cn("rounded-md border border-border bg-surface-2 px-2 py-0.5 text-secondary transition-colors hover:border-border-strong hover:text-fg")}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
