"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MonthPicker({
  basePath,
  month,
  options,
  prev,
  next,
}: {
  basePath: string;
  month: string;
  options: { value: string; label: string }[];
  prev: string;
  next: string | null;
}) {
  const router = useRouter();
  return (
    <div className="no-print flex items-center gap-1">
      <Link href={`${basePath}?month=${prev}`} className={buttonClass("ghost", "icon")} aria-label="Previous month">
        <ChevronLeft />
      </Link>
      <select
        aria-label="Report month"
        value={month}
        onChange={(e) => router.push(`${basePath}?month=${e.target.value}`)}
        className="h-8 rounded-lg border border-border bg-surface-2 px-2.5 text-[13px] text-fg hover:border-border-strong focus:border-accent focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {next ? (
        <Link href={`${basePath}?month=${next}`} className={buttonClass("ghost", "icon")} aria-label="Next month">
          <ChevronRight />
        </Link>
      ) : (
        <span className={cn(buttonClass("ghost", "icon"), "pointer-events-none opacity-30")} aria-hidden>
          <ChevronRight />
        </span>
      )}
    </div>
  );
}
