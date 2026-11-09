"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Segmented period control that writes ?period= to the URL (one control row, above the charts). */
export function PeriodPicker({ options, value }: { options: { value: string; label: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-wrap rounded-lg bg-surface-2 p-0.5 ring-1 ring-border" role="tablist" aria-label="Period">
        {options.map((o) => (
          <button
            key={o.value}
            role="tab"
            aria-selected={o.value === value}
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              next.set("period", o.value);
              start(() => router.replace(`${pathname}?${next}`, { scroll: false }));
            }}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-all duration-150",
              o.value === value ? "bg-surface-3 text-fg shadow-sm" : "text-muted hover:text-secondary",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {pending && <Loader2 className="size-4 animate-spin text-muted" />}
    </div>
  );
}
