"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ChevronRight, Command, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV, isActive, type NavItem } from "./nav";
import { UserMenu } from "./user-menu";

function setCollapsedCookie(collapsed: boolean) {
  document.cookie = `sidebar=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
}

export function Sidebar({
  initialCollapsed,
  user,
  mobileOpen,
  onNavigate,
}: {
  initialCollapsed: boolean;
  user: { email: string | null; name: string | null };
  mobileOpen: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NAV.filter((n) => n.children).map((n) => [n.href, isActive(pathname, n.href)])),
  );

  // Auto-expand the section of the page you navigate to.
  useEffect(() => {
    const section = NAV.find((n) => n.children && isActive(pathname, n.href));
    if (section) setOpen((o) => (o[section.href] ? o : { ...o, [section.href]: true }));
  }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      setCollapsedCookie(!c);
      return !c;
    });
  };

  const isCollapsed = collapsed && !mobileOpen;

  return (
    <Tooltip.Provider delayDuration={300}>
      <aside
        className={cn(
          "no-print fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-bg-subtle transition-[width,transform] duration-200 ease-out lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          isCollapsed ? "w-[60px]" : "w-[248px]",
          mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className={cn("flex h-14 items-center gap-2 px-3", isCollapsed && "justify-center px-0")}>
          <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 overflow-hidden rounded-lg px-1.5 py-1">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-strong text-white shadow-[0_0_0_1px_rgb(255_255_255/0.08)_inset]">
              <Command className="size-3.5" />
            </span>
            {!isCollapsed && <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">Command Centre</span>}
          </Link>
          {!isCollapsed && (
            <button
              onClick={toggleCollapsed}
              className="ml-auto hidden rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg lg:block"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <NavEntry
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={isCollapsed}
                open={open[item.href] ?? false}
                onToggle={() => setOpen((o) => ({ ...o, [item.href]: !o[item.href] }))}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </nav>

        <div className={cn("border-t border-border p-2", isCollapsed && "flex flex-col items-center gap-1")}>
          {isCollapsed && (
            <button
              onClick={toggleCollapsed}
              className="hidden rounded-md p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg lg:block"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          )}
          <UserMenu user={user} collapsed={isCollapsed} />
        </div>
      </aside>
    </Tooltip.Provider>
  );
}

function NavEntry({
  item,
  pathname,
  collapsed,
  open,
  onToggle,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const active = isActive(pathname, item.href);
  const exact = pathname === item.href;
  const Icon = item.icon;
  const rowClass = cn(
    "group flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors duration-150",
    exact ? "bg-surface-3 text-fg" : active ? "text-fg" : "text-secondary hover:bg-surface-2 hover:text-fg",
    collapsed && "justify-center px-0",
  );

  const link = (
    <Link href={item.href} onClick={onNavigate} className={rowClass} aria-current={exact ? "page" : undefined}>
      <Icon className={cn("size-4 shrink-0", active ? "text-accent-text" : "text-muted group-hover:text-secondary")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <li>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="right" sideOffset={8} className="card z-50 px-2 py-1 text-[12px] data-[state=delayed-open]:animate-fade-in">
              {item.label}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </li>
    );
  }

  return (
    <li>
      <div className="relative flex items-center">
        {link}
        {item.children && (
          <button
            onClick={onToggle}
            className="absolute right-1 rounded-md p-1 text-muted opacity-70 transition hover:bg-surface-3 hover:text-fg hover:opacity-100"
            aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
            aria-expanded={open}
          >
            <ChevronRight className={cn("size-3.5 transition-transform duration-200", open && "rotate-90")} />
          </button>
        )}
      </div>
      {item.children && (
        <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <ul className="overflow-hidden">
            <div className="relative ml-[17px] space-y-0.5 border-l border-border py-0.5 pl-2.5">
              {item.children.map((child) => {
                const childActive = isActive(pathname, child.href);
                return (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      onClick={onNavigate}
                      aria-current={childActive ? "page" : undefined}
                      className={cn(
                        "flex h-7 items-center rounded-md px-2 text-[12.5px] transition-colors duration-150",
                        childActive ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      {child.label}
                    </Link>
                  </li>
                );
              })}
            </div>
          </ul>
        </div>
      )}
    </li>
  );
}
