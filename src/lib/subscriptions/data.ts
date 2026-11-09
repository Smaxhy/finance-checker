import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Subscription } from "@/lib/types";
import { addDays, toISODate } from "@/lib/dates";
import { must } from "@/lib/data/core";
import { formatMoney } from "@/lib/format";
import { computeAttention, normalizeSubscription, type AttentionItem, type Charge } from "./helpers";

export interface SubscriptionsData {
  subscriptions: Subscription[];
  chargesBySubscription: Map<string, Charge[]>;
  chargesAfterCancel: Map<string, Charge[]>;
  cancellationEmails: Map<string, { id: string; received_at: string }[]>;
  attention: AttentionItem[];
}

export async function loadSubscriptions(supabase: AppSupabaseClient): Promise<Subscription[]> {
  const rows = must(await supabase.from("subscriptions").select("*").order("name"), "subscriptions") as Record<string, unknown>[];
  return rows.map(normalizeSubscription);
}

/** Assigns charges to subscriptions: linked by id, or unlinked with the same merchant key. */
export function groupCharges(subs: Subscription[], charges: Charge[]): Map<string, Charge[]> {
  const byKey = new Map<string, Subscription[]>();
  for (const s of subs) byKey.set(s.merchant_key, [...(byKey.get(s.merchant_key) ?? []), s]);
  const out = new Map<string, Charge[]>();
  for (const c of charges) {
    const owner = c.subscription_id ? subs.find((s) => s.id === c.subscription_id) : byKey.get(c.merchant_key ?? "")?.[0];
    if (!owner) continue;
    out.set(owner.id, [...(out.get(owner.id) ?? []), c]);
  }
  return out;
}

export async function loadSubscriptionsData(supabase: AppSupabaseClient, today = new Date(), currency = "EUR"): Promise<SubscriptionsData> {
  const subscriptions = await loadSubscriptions(supabase);
  const keys = [...new Set(subscriptions.map((s) => s.merchant_key))].filter((k) => /^[a-z0-9._-]+$/i.test(k));
  const [chargeRes, emailRes] = await Promise.all([
    keys.length
      ? supabase
          .from("transactions")
          .select("id, booked_at, amount, subscription_id, merchant_key")
          .in("merchant_key", keys)
          .lt("amount", 0)
          .gte("booked_at", toISODate(addDays(today, -400)))
          .order("booked_at")
      : Promise.resolve({ data: [], error: null }),
    supabase.from("emails").select("id, merchant_key, received_at").eq("category", "cancellation").not("merchant_key", "is", null).order("received_at", { ascending: false }),
  ]);
  const charges = (must(chargeRes, "charges") as Charge[]).map((c) => ({ ...c, amount: Number(c.amount) }));
  const chargesBySubscription = groupCharges(subscriptions, charges);

  const chargesAfterCancel = new Map<string, Charge[]>();
  for (const s of subscriptions) {
    if (s.status !== "cancelled" || !s.cancellation_confirmed_at) continue;
    const confirmedDay = s.cancellation_confirmed_at.slice(0, 10);
    const after = (chargesBySubscription.get(s.id) ?? []).filter((c) => c.booked_at > confirmedDay);
    if (after.length) chargesAfterCancel.set(s.id, after);
  }

  const cancellationEmails = new Map<string, { id: string; received_at: string }[]>();
  for (const e of must(emailRes, "cancellation emails") as { id: string; merchant_key: string; received_at: string }[]) {
    cancellationEmails.set(e.merchant_key, [...(cancellationEmails.get(e.merchant_key) ?? []), { id: e.id, received_at: e.received_at }]);
  }

  const attention = computeAttention(subscriptions, {
    today,
    chargesBySubscription,
    chargesAfterCancel,
    cancellationEmails,
    formatMoney: (n) => formatMoney(n, currency),
  });
  return { subscriptions, chargesBySubscription, chargesAfterCancel, cancellationEmails, attention };
}
