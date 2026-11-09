"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Check, CheckCheck, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { deleteNotification, markAllNotificationsRead, markNotificationRead, refreshNotifications } from "@/app/actions/notifications";
import { severityColor, severityIcon } from "@/components/shell/notification-bell";
import { Button } from "@/components/ui/button";
import { DemoBadge } from "@/components/ui/badge";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface NotificationView {
  id: string;
  title: string;
  body: string | null;
  severity: Severity;
  link: string | null;
  read: boolean;
  isDemo: boolean;
  typeLabel: string;
  timeLabel: string;
  dayGroup: string;
}

const severityRing: Record<Severity, string> = {
  info: "border-accent/25 bg-accent-soft",
  success: "border-positive/25 bg-positive-soft",
  warning: "border-warning/25 bg-warning-soft",
  critical: "border-danger/30 bg-danger-soft",
};

export function RefreshNotificationsButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await refreshNotifications();
          toast.success(res.created ? `${res.created} new notification${res.created === 1 ? "" : "s"}` : "No new notifications", {
            description: "Checked upcoming payments, trials, price changes, large purchases and events.",
          });
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now
    </Button>
  );
}

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          await markAllNotificationsRead();
          router.refresh();
        })
      }
    >
      <CheckCheck /> Mark all read
    </Button>
  );
}

export function NotificationCenter({ items }: { items: NotificationView[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [list, apply] = useOptimistic(items, (state, change: { id: string; read?: boolean; deleted?: boolean }) =>
    change.deleted ? state.filter((n) => n.id !== change.id) : state.map((n) => (n.id === change.id ? { ...n, read: change.read ?? n.read } : n)),
  );

  const markRead = (n: NotificationView) =>
    start(async () => {
      apply({ id: n.id, read: true });
      await markNotificationRead(n.id);
      router.refresh();
    });
  const remove = (n: NotificationView) =>
    start(async () => {
      apply({ id: n.id, deleted: true });
      await deleteNotification(n.id);
      router.refresh();
    });

  const groups: { day: string; items: NotificationView[] }[] = [];
  for (const n of list) {
    const g = groups[groups.length - 1];
    if (g && g.day === n.dayGroup) g.items.push(n);
    else groups.push({ day: n.dayGroup, items: [n] });
  }

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.day} aria-label={g.day}>
          <h2 className="mb-2 px-1 text-[12.5px] font-medium text-secondary">{g.day}</h2>
          <ul className="card divide-y divide-border p-0">
            {g.items.map((n) => {
              const Icon = severityIcon[n.severity];
              return (
                <li key={n.id} className={cn("group flex gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/60", n.read && "opacity-65")}>
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border", severityRing[n.severity])}>
                    <Icon className={cn("size-3.5", severityColor[n.severity])} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] leading-snug font-medium">
                      {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                      {n.link ? (
                        <Link href={n.link} onClick={() => !n.read && markRead(n)} className="hover:underline">
                          {n.title}
                        </Link>
                      ) : (
                        n.title
                      )}
                      {n.isDemo && <DemoBadge />}
                    </p>
                    {n.body && <p className="mt-0.5 text-[12.5px] text-muted">{n.body}</p>}
                    <p className="mt-1 text-[11.5px] text-muted">
                      {n.typeLabel} · {n.timeLabel}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    {n.link && (
                      <Link href={n.link} onClick={() => !n.read && markRead(n)} className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-fg" aria-label="Open">
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    )}
                    {!n.read && (
                      <button type="button" onClick={() => markRead(n)} className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-fg" aria-label="Mark as read">
                        <Check className="size-3.5" />
                      </button>
                    )}
                    <button type="button" onClick={() => remove(n)} className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-danger" aria-label="Delete notification">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
