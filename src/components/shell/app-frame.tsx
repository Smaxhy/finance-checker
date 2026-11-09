"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import Link from "next/link";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { NotificationBell, type BellNotification } from "./notification-bell";
import { findTrail } from "./nav";
import { MobileTabBar } from "./mobile-nav";
import { Kbd } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function AppFrame({
  children,
  initialCollapsed,
  user,
  notifications,
  unreadCount,
  hasDemoData,
}: {
  children: ReactNode;
  initialCollapsed: boolean;
  user: { email: string | null; name: string | null };
  notifications: BellNotification[];
  unreadCount: number;
  hasDemoData: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const trail = findTrail(pathname);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Lock page scroll behind the open mobile drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen">
      <Sidebar initialCollapsed={initialCollapsed} user={user} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-[var(--overlay)] backdrop-blur-[2px] animate-fade-in lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 border-b border-border bg-bg/80 pt-safe backdrop-blur-xl">
          <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[14px] sm:text-[13px]">
            {trail.length === 0 ? (
              <span className="text-secondary">Command Centre</span>
            ) : (
              trail.map((t, i) => (
                <span key={t.href} className={cn("flex min-w-0 items-center gap-1.5", i < trail.length - 1 && "hidden sm:flex")}>
                  {i > 0 && <span className="hidden text-muted sm:inline">/</span>}
                  <Link href={t.href} className={cn("truncate", i === trail.length - 1 ? "font-medium text-fg" : "text-muted hover:text-secondary")}>
                    {t.label}
                  </Link>
                </span>
              ))
            )}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            {hasDemoData && (
              <Link
                href="/settings/preferences#demo"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-warning ring-1 ring-warning/35 ring-inset transition-colors hover:bg-warning-soft"
                title="Some of the data you are seeing is generated sample data"
              >
                <span className="size-1.5 rounded-full bg-warning" /> <span className="sm:hidden">Demo</span>
                <span className="hidden sm:inline">Demo data loaded</span>
              </Link>
            )}
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Search or jump to"
              className="flex size-10 items-center justify-center gap-2 rounded-lg text-muted transition-colors hover:text-secondary sm:h-8 sm:w-auto sm:border sm:border-border sm:bg-surface sm:px-2.5 sm:text-[12.5px] sm:hover:border-border-strong"
            >
              <Search className="size-4 sm:size-3.5" />
              <span className="hidden md:inline">Search or jump to…</span>
              <span className="hidden items-center gap-0.5 md:flex">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <NotificationBell notifications={notifications} unreadCount={unreadCount} />
          </div>
          </div>
        </header>

        <main
          key={pathname}
          className="mx-auto w-full max-w-[1320px] flex-1 animate-slide-up px-4 pt-5 pb-[calc(96px+env(safe-area-inset-bottom))] lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>

      <MobileTabBar onMore={() => setMobileOpen((o) => !o)} moreOpen={mobileOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
