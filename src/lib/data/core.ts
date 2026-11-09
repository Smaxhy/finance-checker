import "server-only";
import { cache } from "react";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import type { AppNotification, Category, NotificationPrefs, Profile } from "@/lib/types";

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  upcoming_payment: true,
  trial_ending: true,
  new_recurring: true,
  price_increase: true,
  large_purchase: true,
  upcoming_bill: true,
  event_soon: true,
  unusual_spending: true,
  charge_after_cancel: true,
  days_ahead: 3,
};

export function notificationPrefs(profile: Pick<Profile, "notification_prefs"> | null): NotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(profile?.notification_prefs ?? {}) };
}

/** Throws on query errors so failures surface instead of rendering misleading empty states. */
export function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Failed to load ${what}: ${result.error.message}`);
  return (result.data ?? ([] as unknown)) as T;
}

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!data) return null;
  return { ...data, large_purchase_threshold: Number(data.large_purchase_threshold) } as Profile;
});

export const getCategories = cache(async (): Promise<Category[]> => {
  const supabase = await createClient();
  const rows = must(await supabase.from("categories").select("*").order("sort_order").order("name"), "categories");
  return rows as Category[];
});

export async function categoryMap(): Promise<Map<string, Category>> {
  return new Map((await getCategories()).map((c) => [c.id, c]));
}

export async function listNotifications(supabase: AppSupabaseClient, opts: { limit?: number; unreadOnly?: boolean } = {}) {
  let q = supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  if (opts.unreadOnly) q = q.is("read_at", null);
  return must(await q, "notifications") as AppNotification[];
}

export async function unreadNotificationCount(supabase: AppSupabaseClient): Promise<number> {
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return count ?? 0;
}

export async function hasDemoData(supabase: AppSupabaseClient): Promise<boolean> {
  const { count } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("is_demo", true);
  if ((count ?? 0) > 0) return true;
  const { count: subs } = await supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("is_demo", true);
  return (subs ?? 0) > 0;
}

export async function hasAnyData(supabase: AppSupabaseClient): Promise<boolean> {
  const checks = await Promise.all([
    supabase.from("transactions").select("id", { count: "exact", head: true }),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }),
    supabase.from("emails").select("id", { count: "exact", head: true }),
    supabase.from("events").select("id", { count: "exact", head: true }),
  ]);
  return checks.some((c) => (c.count ?? 0) > 0);
}
