"use client";
// App shell of the GitHub Pages edition: same frame as the server edition, fed from on-device data.
import { useEffect, useState, type ReactNode } from "react";
import { AppFrame } from "@/components/shell/app-frame";
import type { BellNotification } from "@/components/shell/notification-bell";
import { getProfile, hasDemoData, listNotifications, unreadNotificationCount } from "@/lib/data/core";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";
import { flushNow, localDb, ready } from "@/lib/local/db";
import { connectionsNeedingSignIn, googleConnections, startRefresh } from "@/lib/local/google";
import { getGoogleClientId } from "@/lib/local/prefs";
import { useLocalVersion } from "@/lib/local/runtime";
import type { AppSupabaseClient } from "@/lib/local/server";

const db = localDb as unknown as AppSupabaseClient;

interface ShellData {
  name: string | null;
  notifications: BellNotification[];
  unread: number;
  demo: boolean;
}

/**
 * Google's read-only pass lasts about an hour, so after a while the mailboxes can't be
 * checked without a quick hop to Google. This bar offers that in one tap.
 */
function MailCheckBar({ version }: { version: number }) {
  const [due, setDue] = useState<{ ids: string[]; last: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const waiting = await connectionsNeedingSignIn();
      const last = Number(localStorage.getItem("cc:lastMailCheck") ?? 0);
      if (cancelled) return;
      // Only nag when every connected account is waiting and the last check is over an hour old.
      const all = await googleConnections();
      setDue(waiting.length > 0 && waiting.length === all.length && Date.now() - last > 3600_000 && Boolean(getGoogleClientId()) ? { ids: waiting.map((c) => c.id), last } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!due || dismissed) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-[12.5px]" data-testid="mail-check-bar">
      <span className="flex min-w-0 items-center gap-2 text-secondary">
        <MailCheck className="size-4 shrink-0 text-accent-text" />
        <span>
          {due.last ? `Your email was last checked ${relativeTime(new Date(due.last))}.` : "Your email hasn't been checked yet."}{" "}
          <span className="text-muted">Checking hops to Google and straight back.</span>
        </span>
      </span>
      <span className="flex gap-1.5">
        <Button variant="primary" size="sm" onClick={() => void flushNow().then(() => startRefresh(due.ids))}>
          Check {due.ids.length > 1 ? `${due.ids.length} accounts` : "now"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          Later
        </Button>
      </span>
    </div>
  );
}

export default function LocalAppLayout({ children }: { children: ReactNode }) {
  const version = useLocalVersion();
  const [data, setData] = useState<ShellData>({ name: null, notifications: [], unread: 0, demo: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ready();
      const [profile, notifications, unread, demo] = await Promise.all([getProfile(), listNotifications(db, { limit: 8 }), unreadNotificationCount(db), hasDemoData(db)]);
      if (cancelled) return;
      setData({
        name: profile?.display_name ?? null,
        notifications: notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, severity: n.severity, link: n.link, read_at: n.read_at, created_at: n.created_at })),
        unread,
        demo,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <AppFrame initialCollapsed={false} user={{ email: null, name: data.name }} notifications={data.notifications} unreadCount={data.unread} hasDemoData={data.demo}>
      <MailCheckBar version={version} />
      {children}
    </AppFrame>
  );
}
