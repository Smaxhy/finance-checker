import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "positive" | "warning" | "danger" | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-secondary",
  accent: "bg-accent-soft text-accent-text",
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  outline: "border border-border text-secondary",
};

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11.5px] font-medium [&_svg]:size-3",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Marks anything that came from generated sample data. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      title="Sample data for exploring the app - not your real information"
      className={cn(
        "inline-flex h-4 items-center rounded px-1 text-[10px] font-semibold tracking-wide text-warning ring-1 ring-warning/40 ring-inset",
        className,
      )}
    >
      DEMO
    </span>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span className={cn("inline-block size-1.5 rounded-full bg-current", className)} />;
}
