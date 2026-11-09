"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, LayoutDashboard, Menu, Repeat, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive, NAV } from "./nav";

const TABS: { label: string; href: string; match: string; icon: LucideIcon }[] = [
  { label: "Overview", href: "/", match: "/", icon: LayoutDashboard },
  { label: "Money", href: "/finances/transactions", match: "/finances", icon: Wallet },
  { label: "Subscriptions", href: "/subscriptions", match: "/subscriptions", icon: Repeat },
  { label: "Calendar", href: "/calendar", match: "/calendar", icon: CalendarDays },
];

/** Phone-only bottom tab bar. "More" opens the full navigation drawer. */
export function MobileTabBar({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const pathname = usePathname();
  const inTabs = TABS.some((t) => isActive(pathname, t.match));
  const moreActive = moreOpen || (!inTabs && NAV.some((n) => isActive(pathname, n.href)));
  const item = "flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-[10.5px] font-medium transition-colors";
  return (
    <nav
      aria-label="Primary"
      className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/85 pb-safe backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map((t) => {
          const active = !moreOpen && isActive(pathname, t.match);
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={cn(item, active ? "text-fg" : "text-muted")}>
              <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-accent-soft text-accent-text")}>
                <t.icon className="size-[18px]" />
              </span>
              {t.label}
            </Link>
          );
        })}
        <button onClick={onMore} aria-expanded={moreOpen} className={cn(item, moreActive ? "text-fg" : "text-muted")}>
          <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", moreActive && "bg-accent-soft text-accent-text")}>
            <Menu className="size-[18px]" />
          </span>
          More
        </button>
      </div>
    </nav>
  );
}
