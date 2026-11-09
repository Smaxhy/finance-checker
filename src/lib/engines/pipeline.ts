// Holds no secrets: queries go through the caller's row-level-security client, so this
// also runs in the browser-only GitHub Pages edition (against on-device data).
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { BillingCycle, Subscription, Transaction } from "@/lib/types";
import { pairInternalTransfers } from "@/lib/finance/categorize";
import { merchantByKey } from "@/lib/finance/merchants";
import { detectRecurring } from "@/lib/finance/recurring";
import { addDays, toISODate } from "@/lib/dates";
import { must } from "@/lib/data/core";
import { refreshNotificationsForUser } from "./notifications";

export interface PipelineResult {
  transfersPaired: number;
  subscriptionsCreated: number;
  subscriptionsUpdated: number;
  transactionsLinked: number;
  notificationsCreated: number;
}

const USER_MANAGED_STATUSES = new Set(["cancelled", "cancellation_pending", "paused"]);

/**
 * Runs after any data import (bank sync, CSV import, email sync, demo data).
 * Idempotent and conservative: it never changes a status the user set and
 * never marks anything as cancelled.
 */
export async function runPipeline(supabase: AppSupabaseClient, userId: string, opts: { demo?: boolean; today?: Date } = {}): Promise<PipelineResult> {
  const today = opts.today ?? new Date();
  const result: PipelineResult = { transfersPaired: 0, subscriptionsCreated: 0, subscriptionsUpdated: 0, transactionsLinked: 0, notificationsCreated: 0 };

  // 1. Pair transfers between own accounts that weren't recognised by IBAN or wording.
  const recent = must(
    await supabase
      .from("transactions")
      .select("id, account_id, booked_at, amount, kind")
      .eq("user_id", userId)
      .neq("kind", "transfer")
      .gte("booked_at", toISODate(addDays(today, -120))),
    "recent transactions",
  ) as Pick<Transaction, "id" | "account_id" | "booked_at" | "amount" | "kind">[];
  const { count: accountCount } = await supabase.from("accounts").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((accountCount ?? 0) > 1) {
    const ids = pairInternalTransfers(recent.map((t) => ({ ...t, amount: Number(t.amount) })));
    if (ids.length) {
      await supabase.from("transactions").update({ kind: "transfer", category_id: "transfers" }).in("id", ids).neq("category_source", "user");
      result.transfersPaired = ids.length;
    }
  }

  // 2. Detect recurring charges over the last ~13 months.
  const history = must(
    await supabase
      .from("transactions")
      .select("id, booked_at, amount, kind, merchant, merchant_key, category_id")
      .eq("user_id", userId)
      .lt("amount", 0)
      .gte("booked_at", toISODate(addDays(today, -400)))
      .order("booked_at"),
    "transaction history",
  ) as Pick<Transaction, "id" | "booked_at" | "amount" | "kind" | "merchant" | "merchant_key" | "category_id">[];
  const candidates = detectRecurring(
    history.map((t) => ({ ...t, amount: Number(t.amount) })),
    today,
  ).filter((c) => c.confidence >= 0.6);

  const existing = must(await supabase.from("subscriptions").select("*").eq("user_id", userId), "subscriptions") as Subscription[];
  const byKey = new Map<string, Subscription>();
  for (const s of existing) if (!byKey.has(s.merchant_key) || s.status === "active") byKey.set(s.merchant_key, s);

  for (const c of candidates) {
    const entry = merchantByKey(c.merchantKey);
    const current = byKey.get(c.merchantKey);
    if (current) {
      const update: Partial<Subscription> & Record<string, unknown> = {
        amount: c.amount,
        last_payment_date: c.lastDate,
        last_payment_amount: c.amount,
        charge_count: c.chargeCount,
        detection_confidence: c.confidence,
      };
      if (!USER_MANAGED_STATUSES.has(current.status)) update.next_payment_date = c.nextDate;
      if (c.previousAmount !== null && c.priceChangedAt && current.price_changed_at !== c.priceChangedAt) {
        update.previous_amount = c.previousAmount;
        update.price_changed_at = c.priceChangedAt;
      }
      // A trial that has started charging has converted to a paid plan.
      if (current.status === "trial" && current.trial_ends_at && c.lastDate >= current.trial_ends_at) update.status = "active";
      if (current.billing_cycle === "unknown") update.billing_cycle = c.cycle;
      await supabase.from("subscriptions").update(update).eq("id", current.id);
      result.subscriptionsUpdated++;
      const { count } = await supabase.from("transactions").update({ subscription_id: current.id }, { count: "exact" }).in("id", c.transactionIds).is("subscription_id", null);
      result.transactionsLinked += count ?? 0;
    } else {
      const { data: created, error } = await supabase
        .from("subscriptions")
        .insert({
          user_id: userId,
          name: c.name,
          provider: entry?.name ?? c.name,
          merchant_key: c.merchantKey,
          category_id: c.categoryId,
          amount: c.amount,
          billing_cycle: c.cycle,
          status: "active",
          next_payment_date: c.nextDate,
          last_payment_date: c.lastDate,
          last_payment_amount: c.amount,
          previous_amount: c.previousAmount,
          price_changed_at: c.priceChangedAt,
          started_at: c.firstDate,
          cancel_url: entry?.subscription?.cancelUrl ?? null,
          cancel_instructions: entry?.subscription?.steps.join("\n") ?? null,
          detection_source: opts.demo ? "demo" : "bank",
          detection_confidence: c.confidence,
          charge_count: c.chargeCount,
          is_demo: Boolean(opts.demo),
        })
        .select("id")
        .single();
      if (error || !created) continue; // e.g. unique clash on (merchant_key, cycle) - safe to skip
      result.subscriptionsCreated++;
      const { count } = await supabase.from("transactions").update({ subscription_id: created.id }, { count: "exact" }).in("id", c.transactionIds);
      result.transactionsLinked += count ?? 0;
    }
  }

  // 3. Subscriptions and trials that only exist in email so far.
  const subEmails = must(
    await supabase
      .from("emails")
      .select("id, category, merchant, merchant_key, amount, currency, extracted, received_at, is_demo")
      .eq("user_id", userId)
      .in("category", ["subscription", "trial", "renewal"])
      .not("merchant_key", "is", null)
      .gte("received_at", addDays(today, -400).toISOString())
      .order("received_at", { ascending: true }),
    "subscription emails",
  ) as { id: string; category: string; merchant: string | null; merchant_key: string; amount: number | null; currency: string | null; extracted: Record<string, unknown>; received_at: string; is_demo: boolean }[];

  const refreshed = must(await supabase.from("subscriptions").select("id, merchant_key, status, next_payment_date, last_email_at").eq("user_id", userId), "subscriptions") as Pick<
    Subscription,
    "id" | "merchant_key" | "status" | "next_payment_date" | "last_email_at"
  >[];
  const known = new Map(refreshed.map((s) => [s.merchant_key, s]));
  for (const e of subEmails) {
    const x = e.extracted ?? {};
    const trialEnd = typeof x.trial_end_date === "string" ? x.trial_end_date : null;
    const renewal = typeof x.renewal_date === "string" ? x.renewal_date : null;
    const cycle = (typeof x.billing_cycle === "string" && ["weekly", "monthly", "quarterly", "semiannual", "yearly"].includes(x.billing_cycle) ? x.billing_cycle : "monthly") as BillingCycle;
    const sub = known.get(e.merchant_key);
    if (sub) {
      const update: Record<string, unknown> = { last_email_at: e.received_at };
      if (renewal && !USER_MANAGED_STATUSES.has(sub.status) && renewal >= toISODate(today)) update.next_payment_date = renewal;
      await supabase.from("subscriptions").update(update).eq("id", sub.id);
      continue;
    }
    if (e.category === "renewal" && !renewal) continue;
    const entry = merchantByKey(e.merchant_key);
    const isTrial = e.category === "trial" && trialEnd && trialEnd >= toISODate(addDays(today, -3));
    const { data: created } = await supabase
      .from("subscriptions")
      .insert({
        user_id: userId,
        name: entry?.name ?? e.merchant ?? e.merchant_key,
        provider: entry?.name ?? e.merchant,
        merchant_key: e.merchant_key,
        category_id: entry?.category === "subscriptions" || !entry ? "subscriptions" : entry.category,
        amount: e.amount,
        currency: e.currency ?? "EUR",
        billing_cycle: cycle,
        status: isTrial ? "trial" : "active",
        trial_ends_at: isTrial ? trialEnd : null,
        next_payment_date: isTrial ? trialEnd : renewal,
        started_at: e.received_at.slice(0, 10),
        cancel_url: entry?.subscription?.cancelUrl ?? null,
        cancel_instructions: entry?.subscription?.steps.join("\n") ?? null,
        detection_source: e.is_demo ? "demo" : "email",
        detection_confidence: 0.7,
        last_email_at: e.received_at,
        is_demo: e.is_demo,
      })
      .select("id, merchant_key, status, next_payment_date, last_email_at")
      .single();
    if (created) {
      known.set(e.merchant_key, created as (typeof refreshed)[number]);
      result.subscriptionsCreated++;
    }
  }

  // Past-due next_payment_date values are deliberately left alone: a missed
  // expected charge is shown in the UI as "overdue - possibly cancelled".
  result.notificationsCreated = await refreshNotificationsForUser(supabase, userId, today);
  return result;
}
