import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppFrame } from "@/components/shell/app-frame";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getProfile, hasDemoData, listNotifications, unreadNotificationCount } from "@/lib/data/core";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const [profile, notifications, unread, demo, cookieStore] = await Promise.all([
    getProfile(),
    listNotifications(supabase, { limit: 8 }),
    unreadNotificationCount(supabase),
    hasDemoData(supabase),
    cookies(),
  ]);

  return (
    <AppFrame
      initialCollapsed={cookieStore.get("sidebar")?.value === "collapsed"}
      user={{ email: user.email, name: profile?.display_name ?? null }}
      notifications={notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        severity: n.severity,
        link: n.link,
        read_at: n.read_at,
        created_at: n.created_at,
      }))}
      unreadCount={unread}
      hasDemoData={demo}
    >
      {children}
    </AppFrame>
  );
}
