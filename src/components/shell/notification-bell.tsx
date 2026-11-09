"use client";
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useTransition } from "react";
import { AlertTriangle, Bell, CheckCheck, CircleCheck, Info, OctagonAlert } from "lucide-react";
import { markAllNotificationsRead, markNotificationRead } from "@/app/actions/notifications";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/types";

export interface BellNotification {
  id: string;
  title: string;
  body: string | null;
  severity: Severity;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export const severityIcon = { info: Info, success: CircleCheck, warning: AlertTriangle, critical: OctagonAlert } as const;
export const severityColor = { info: "text-accent-text", success: "text-positive", warning: "text-warning", critical: "text-danger" } as const;

export function NotificationBell({ notifications, unreadCount }: { notifications: BellNotification[]; unreadCount: number }) {
  const [pending, start] = useTransition();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="relative flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:size-8" aria-label={`Notifications (${unreadCount} unread)`}>
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex sm:top-0.5 sm:right-0.5 h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent-strong px-1 text-[9.5px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} collisionPadding={8} className="card z-50 w-[380px] max-w-[calc(100vw-16px)] p-0 data-[state=open]:animate-pop">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-[13px] font-medium">Notifications</p>
            <button
              disabled={pending || unreadCount === 0}
              onClick={() => start(() => markAllNotificationsRead())}
              className="flex items-center gap-1 text-[12px] text-muted transition-colors hover:text-fg disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          </div>
          <div className="max-h-[min(420px,65dvh)] overflow-y-auto overscroll-contain">
            {notifications.length === 0 ? (
              <p className="px-4 py-10 text-center text-[12.5px] text-muted">You’re all caught up.</p>
            ) : (
              notifications.map((n) => {
                const Icon = severityIcon[n.severity];
                const content = (
                  <div className={cn("flex gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-surface-2", n.read_at && "opacity-60")}>
                    <Icon className={cn("mt-0.5 size-4 shrink-0", severityColor[n.severity])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug font-medium">{n.title}</p>
                      {n.body && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{n.body}</p>}
                      <p className="mt-1 text-[11.5px] text-muted">{relativeTime(n.created_at)}</p>
                    </div>
                    {!n.read_at && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />}
                  </div>
                );
                return n.link ? (
                  <Popover.Close asChild key={n.id}>
                    <Link href={n.link} onClick={() => !n.read_at && start(() => markNotificationRead(n.id))} className="block">
                      {content}
                    </Link>
                  </Popover.Close>
                ) : (
                  <button key={n.id} className="block w-full text-left" onClick={() => !n.read_at && start(() => markNotificationRead(n.id))}>
                    {content}
                  </button>
                );
              })
            )}
          </div>
          <Popover.Close asChild>
            <Link href="/notifications" className="block border-t border-border px-4 py-2.5 text-center text-[12.5px] text-accent-text hover:bg-surface-2">
              View all notifications
            </Link>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
