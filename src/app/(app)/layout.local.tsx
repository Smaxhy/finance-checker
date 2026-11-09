"use client";
// App shell of the GitHub Pages edition: same frame as the server edition, fed from on-device data.
import { useEffect, useState, type ReactNode } from "react";
import { AppFrame } from "@/components/shell/app-frame";
import type { BellNotification } from "@/components/shell/notification-bell";
import { getProfile, hasDemoData, listNotifications, unreadNotificationCount } from "@/lib/data/core";
import { localDb, ready } from "@/lib/local/db";
import { useLocalVersion } from "@/lib/local/runtime";
import type { AppSupabaseClient } from "@/lib/local/server";

const db = localDb as unknown as AppSupabaseClient;

interface ShellData {
  name: string | null;
  notifications: BellNotification[];
  unread: number;
  demo: boolean;
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
      {children}
    </AppFrame>
  );
}
