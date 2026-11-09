import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Info, Plug } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { IS_LOCAL } from "@/lib/local/mode";

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-fg sm:text-[22px]">{title}</h1>
          {description ? <p className="mt-1 text-[13px] text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

/** Link-based segmented navigation used for sub-sections (Active / Trials / ...). */
export function Tabs({ items, active }: { items: { href: string; label: string; count?: number }[]; active: string }) {
  return (
    <div className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:w-full sm:px-0">
      {items.map((item) => {
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative -mb-px flex items-center gap-1.5 border-b-2 px-2.5 pt-1 pb-2.5 text-[13px] whitespace-nowrap transition-colors",
              isActive ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-secondary",
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className={cn("rounded px-1 text-[11px] tabular", isActive ? "bg-accent-soft text-accent-text" : "bg-surface-3 text-muted")}>
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  upIsGood = false,
  hint,
  icon: Icon,
  children,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  upIsGood?: boolean;
  hint?: ReactNode;
  icon?: LucideIcon;
  children?: ReactNode;
  className?: string;
}) {
  const hasDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const good = hasDelta && (upIsGood ? delta! >= 0 : delta! <= 0);
  return (
    <div className={cn("card flex min-w-0 flex-col p-3.5 sm:p-4", className)}>
      <div className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
          <span className="truncate">{label}</span>
        </span>
      </div>
      <div className="mt-2 truncate text-[19px] leading-tight font-semibold tracking-[-0.02em] text-fg sm:text-[24px]">{value}</div>
      <div className="mt-1.5 flex min-h-[18px] flex-wrap items-center gap-x-1.5 text-[12px]">
        {hasDelta ? (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", good ? "text-positive" : "text-danger")}>
            {delta! >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(delta! * 100).toFixed(0)}%
          </span>
        ) : null}
        {deltaLabel ? <span className="text-muted">{deltaLabel}</span> : null}
        {hint ? <span className="text-muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function Money({
  value,
  currency = "EUR",
  className,
  colorPositive = false,
  sign = false,
}: {
  value: number | null | undefined;
  currency?: string;
  className?: string;
  colorPositive?: boolean;
  sign?: boolean;
}) {
  return (
    <span className={cn("tabular", colorPositive && (value ?? 0) > 0 && "text-positive", className)}>
      {formatMoney(value, currency, { sign })}
    </span>
  );
}

export function EmptyState({
  icon: Icon = Info,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted">
        <Icon className="size-4.5" />
      </div>
      <p className="text-[13.5px] font-medium text-fg">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[12.5px] text-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Shown wherever a feature needs an integration or configuration that isn't set up. */
export function SetupRequired({
  title,
  description,
  missing,
  action,
  className,
}: {
  title: string;
  description: ReactNode;
  missing?: string[];
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-dashed border-border-strong bg-surface/60 p-4 sm:p-5", className)}>
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
          <Plug className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">{title}</p>
          <div className="mt-1 text-[12.5px] text-muted">
            {IS_LOCAL
              ? "This needs a private server (for Google, bank or AI credentials), which the GitHub Pages edition doesn't have - everything here runs in your browser. Import a bank CSV instead, or deploy the full edition described in the README."
              : description}
          </div>
          {!IS_LOCAL && missing && missing.length > 0 ? (
            <div className="mt-2 hidden flex-wrap gap-1.5 sm:flex">
              {missing.map((m) => (
                <code key={m} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-secondary">
                  {m}
                </code>
              ))}
            </div>
          ) : null}
          {action && !IS_LOCAL ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
          {IS_LOCAL ? (
            <div className="mt-3">
              <Link href="/finances/transactions?import=1" className="text-[12.5px] text-accent-text hover:underline">
                Import a bank CSV →
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Meter({ value, max, className, tone }: { value: number; max: number; className?: string; tone?: "accent" | "warning" | "danger" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const auto = pct >= 100 ? "danger" : pct >= 85 ? "warning" : "accent";
  const t = tone ?? auto;
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          t === "danger" ? "bg-danger" : t === "warning" ? "bg-warning" : "bg-accent",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-sans text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[13px] font-medium text-secondary">{children}</h2>
      {action}
    </div>
  );
}
