// Holds no secrets: queries go through the caller's row-level-security client, so this
// also runs in the browser-only GitHub Pages edition (against on-device data).
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { NotificationPrefs, Profile, Severity, Subscription } from "@/lib/types";
import { addDays, addMonths, endOfMonth, monthKey, monthRange, startOfMonth, toISODate } from "@/lib/dates";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { DEFAULT_NOTIFICATION_PREFS, must } from "@/lib/data/core";
import { spendingByCategory } from "@/lib/data/finance";
import { getUpcoming } from "./upcoming";
import { VARIABLE_CATEGORIES } from "./insights";

interface NewNotification {
  type: keyof Omit<NotificationPrefs, "days_ahead"> | "cancellation_email";
  title: string;
  body?: string;
  severity: Severity;
  link?: string;
  dedupe_key: string;
  is_demo?: boolean;
  data?: Record<string, unknown>;
}

/**
 * Generates notifications from the user's current data. Idempotent: each
 * notification has a dedupe key, so re-running never duplicates and never
 * resets read state. Works with either the user's client or the service-role
 * client (the cron job), always scoped to `userId`.
 */
export async function refreshNotificationsForUser(supabase: AppSupabaseClient, userId: string, today = new Date()): Promise<number> {
  const { data: profileRow } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  const profile = profileRow as Profile | null;
  const prefs: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(profile?.notification_prefs ?? {}) };
  const currency = profile?.base_currency ?? "EUR";
  const threshold = Number(profile?.large_purchase_threshold ?? 150);
  const fmt = (n: number | null | undefined, c = currency) => formatMoney(n ?? 0, c);
  const todayIso = toISODate(today);
  const out: NewNotification[] = [];

  const upcoming = await getUpcoming(supabase, userId, { days: Math.max(prefs.days_ahead, 7), from: today });
  const soonIso = toISODate(addDays(today, prefs.days_ahead));

  for (const u of upcoming) {
    const day = u.date.slice(0, 10);
    if ((u.kind === "subscription" || u.kind === "payment_due") && prefs.upcoming_payment && day <= soonIso) {
      out.push({
        type: "upcoming_payment",
        title: `${u.title} renews ${day === todayIso ? "today" : `on ${formatDate(day, "short")}`}`,
        body: u.amount ? `${fmt(u.amount, u.currency ?? currency)} will be charged.` : "A payment is expected.",
        severity: "info",
        link: u.href,
        dedupe_key: `upcoming:${u.id}`,
        is_demo: u.isDemo,
      });
    }
    if (u.kind === "bill" && prefs.upcoming_bill && day <= soonIso) {
      out.push({
        type: "upcoming_bill",
        title: `${u.title} ${day === todayIso ? "today" : `on ${formatDate(day, "short")}`}`,
        body: u.amount ? `${fmt(u.amount, u.currency ?? currency)} due.` : undefined,
        severity: "info",
        link: u.href,
        dedupe_key: `bill:${u.id}`,
        is_demo: u.isDemo,
      });
    }
    if (u.kind === "trial_end" && prefs.trial_ending) {
      out.push({
        type: "trial_ending",
        title: `${u.title} on ${formatDate(day, "short")}`,
        body: u.amount ? `After that you'll be charged ${fmt(u.amount, u.currency ?? currency)} unless you cancel.` : "Cancel before then if you don't want to keep it.",
        severity: "warning",
        link: u.href,
        dedupe_key: `trial:${u.id}`,
        is_demo: u.isDemo,
      });
    }
    if (u.kind === "cancellation_deadline" && prefs.trial_ending) {
      out.push({ type: "trial_ending", title: u.title, body: `Deadline: ${formatDate(day, "medium")}.`, severity: "warning", link: u.href, dedupe_key: `deadline:${u.id}`, is_demo: u.isDemo });
    }
    if (u.kind === "event" && prefs.event_soon && new Date(u.date).getTime() - today.getTime() <= 48 * 3600_000) {
      out.push({
        type: "event_soon",
        title: `${u.title} ${u.allDay ? formatDate(u.date, "short") : `at ${formatTime(u.date)} on ${formatDate(u.date, "short")}`}`,
        body: [u.subtitle, u.amount ? `${fmt(u.amount, u.currency ?? currency)} still to pay` : null].filter(Boolean).join(" · ") || undefined,
        severity: "info",
        link: u.href,
        dedupe_key: `event:${u.id}`,
        is_demo: u.isDemo,
      });
    }
  }

  const [subsRes, largeRes, cancelEmails] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", userId).eq("dismissed", false),
    supabase
      .from("transactions")
      .select("id, merchant, amount, currency, booked_at, is_demo, category_id")
      .eq("user_id", userId)
      .in("kind", ["expense", "withdrawal"])
      .gte("booked_at", toISODate(addDays(today, -7)))
      .lte("amount", -threshold)
      .neq("category_id", "housing"),
    supabase.from("emails").select("id, merchant_key, merchant, received_at, is_demo").eq("user_id", userId).eq("category", "cancellation").gte("received_at", addDays(today, -45).toISOString()),
  ]);
  const subs = must(subsRes, "subscriptions") as Subscription[];

  for (const s of subs) {
    const amount = s.amount === null ? null : Number(s.amount);
    const prev = s.previous_amount === null ? null : Number(s.previous_amount);
    if (prefs.new_recurring && !s.user_confirmed && (s.detection_source === "bank" || s.detection_source === "email") && Date.now() - Date.parse(s.created_at) < 14 * 86_400_000) {
      const known = s.category_id === "subscriptions";
      out.push({
        type: "new_recurring",
        title: known ? `New subscription detected: ${s.name}` : `Unexpected recurring payment: ${s.name}`,
        body: `${fmt(amount, s.currency)} ${s.billing_cycle}. Review it to confirm or dismiss.`,
        severity: known ? "info" : "warning",
        link: `/subscriptions/${s.id}`,
        dedupe_key: `newsub:${s.id}`,
        is_demo: s.is_demo,
      });
    }
    if (prefs.price_increase && s.price_changed_at && prev && amount && amount > prev && Date.now() - Date.parse(s.price_changed_at) < 45 * 86_400_000) {
      out.push({
        type: "price_increase",
        title: `${s.name} raised its price by ${Math.round(((amount - prev) / prev) * 100)}%`,
        body: `${fmt(prev, s.currency)} → ${fmt(amount, s.currency)} per ${s.billing_cycle.replace("ly", "")}.`,
        severity: "warning",
        link: `/subscriptions/${s.id}`,
        dedupe_key: `price:${s.id}:${s.price_changed_at}`,
        is_demo: s.is_demo,
      });
    }
  }

  // Charges after a confirmed cancellation are a strong red flag.
  if (prefs.charge_after_cancel) {
    const cancelled = subs.filter((s) => s.status === "cancelled" && s.cancellation_confirmed_at);
    if (cancelled.length > 0) {
      const { data: after } = await supabase
        .from("transactions")
        .select("id, amount, currency, booked_at, subscription_id, merchant_key, is_demo")
        .eq("user_id", userId)
        .in("merchant_key", cancelled.map((s) => s.merchant_key))
        .lt("amount", 0)
        .gte("booked_at", toISODate(addDays(today, -60)));
      for (const tx of (after ?? []) as { id: string; amount: number; currency: string; booked_at: string; merchant_key: string; is_demo: boolean }[]) {
        const s = cancelled.find((c) => c.merchant_key === tx.merchant_key);
        if (s && tx.booked_at > s.cancellation_confirmed_at!.slice(0, 10)) {
          out.push({
            type: "charge_after_cancel",
            title: `${s.name} charged you after cancellation`,
            body: `${fmt(-Number(tx.amount), tx.currency)} on ${formatDate(tx.booked_at, "short")}. Contact the provider or your bank.`,
            severity: "critical",
            link: `/subscriptions/${s.id}`,
            dedupe_key: `aftercancel:${tx.id}`,
            is_demo: tx.is_demo,
          });
        }
      }
    }
  }

  // Cancellation confirmation emails: suggest - never auto-apply - the status change.
  for (const e of (cancelEmails.data ?? []) as { id: string; merchant_key: string | null; merchant: string | null; received_at: string; is_demo: boolean }[]) {
    const s = subs.find((x) => x.merchant_key === e.merchant_key && x.status !== "cancelled");
    if (!s) continue;
    out.push({
      type: "cancellation_email",
      title: `Cancellation email from ${e.merchant ?? s.name}`,
      body: `It looks like a cancellation confirmation. Open ${s.name} to review and mark it as confirmed if correct.`,
      severity: "success",
      link: `/subscriptions/${s.id}`,
      dedupe_key: `cancelmail:${e.id}`,
      is_demo: e.is_demo,
    });
  }

  if (prefs.large_purchase) {
    for (const tx of (largeRes.data ?? []) as { id: string; merchant: string | null; amount: number; currency: string; booked_at: string; is_demo: boolean }[]) {
      out.push({
        type: "large_purchase",
        title: `Large purchase: ${fmt(-Number(tx.amount), tx.currency)} at ${tx.merchant ?? "unknown merchant"}`,
        body: `On ${formatDate(tx.booked_at, "medium")}. Your threshold is ${fmt(threshold)}.`,
        severity: "info",
        link: `/finances/transactions?q=${encodeURIComponent(tx.merchant ?? "")}`,
        dedupe_key: `large:${tx.id}`,
        is_demo: tx.is_demo,
      });
    }
  }

  // Unusual spending: a variable category already 1.5x above its typical month.
  if (prefs.unusual_spending) {
    const cur = monthRange(today);
    const [now, past] = await Promise.all([
      spendingByCategory(supabase, cur.from, toISODate(today), userId),
      spendingByCategory(supabase, toISODate(addMonths(startOfMonth(today), -3)), toISODate(endOfMonth(addMonths(startOfMonth(today), -1))), userId),
    ]);
    const avg = new Map(past.map((c) => [c.category_id, c.spent / 3]));
    const { data: cats } = await supabase.from("categories").select("id, name");
    const names = new Map(((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    for (const c of now) {
      if (!VARIABLE_CATEGORIES.has(c.category_id)) continue;
      const a = avg.get(c.category_id) ?? 0;
      if (a >= 40 && c.spent >= a * 1.5 && c.spent - a >= 50) {
        out.push({
          type: "unusual_spending",
          title: `Unusual spending on ${(names.get(c.category_id) ?? c.category_id).toLowerCase()}`,
          body: `${fmt(c.spent)} so far this month vs a typical ${fmt(a)} per month.`,
          severity: "warning",
          link: `/finances/transactions?category=${c.category_id}`,
          dedupe_key: `unusual:${c.category_id}:${monthKey(today)}`,
        });
      }
    }
  }

  if (out.length === 0) return 0;
  const rows = out.map((n) => ({
    user_id: userId,
    type: n.type,
    title: n.title.slice(0, 200),
    body: n.body?.slice(0, 500) ?? null,
    severity: n.severity,
    link: n.link ?? null,
    dedupe_key: n.dedupe_key,
    data: n.data ?? {},
    is_demo: n.is_demo ?? false,
  }));
  const { data, error } = await supabase.from("notifications").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`Failed to save notifications: ${error.message}`);
  return data?.length ?? 0;
}
