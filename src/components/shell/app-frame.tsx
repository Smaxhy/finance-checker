"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { NotificationBell, type BellNotification } from "./notification-bell";
import { findTrail } from "./nav";
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar initialCollapsed={initialCollapsed} user={user} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      {mobileOpen && <div className="fixed inset-0 z-30 bg-[var(--overlay)] lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-xl lg:px-8">
          <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-4.5" />
          </button>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
            {trail.length === 0 ? (
              <span className="text-secondary">Command Centre</span>
            ) : (
              trail.map((t, i) => (
                <span key={t.href} className="flex min-w-0 items-center gap-1.5">
                  {i > 0 && <span className="text-muted">/</span>}
                  <Link href={t.href} className={cn("truncate", i === trail.length - 1 ? "font-medium text-fg" : "text-muted hover:text-secondary")}>
                    {t.label}
                  </Link>
                </span>
              ))
            )}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            {hasDemoData && (
              <Link
                href="/settings/preferences#demo"
                className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-warning ring-1 ring-warning/35 ring-inset transition-colors hover:bg-warning-soft sm:flex"
                title="Some of the data you are seeing is generated sample data"
              >
                <span className="size-1.5 rounded-full bg-warning" /> Demo data loaded
              </Link>
            )}
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[12.5px] text-muted transition-colors hover:border-border-strong hover:text-secondary"
            >
              <Search className="size-3.5" />
              <span className="hidden md:inline">Search or jump to…</span>
              <span className="hidden items-center gap-0.5 md:flex">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <NotificationBell notifications={notifications} unreadCount={unreadCount} />
          </div>
        </header>

        <main key={pathname} className="mx-auto w-full max-w-[1320px] flex-1 animate-slide-up px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
