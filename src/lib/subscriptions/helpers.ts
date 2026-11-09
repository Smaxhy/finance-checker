/**
 * Pure helpers for the subscription tracker: labels, totals, renewal windows,
 * price-change detection from charge history and "needs your attention" flags.
 * No I/O here so everything is unit-testable.
 */
import type { BillingCycle, Subscription, SubscriptionStatus } from "@/lib/types";
import { findSimilarServices, monthlyEquivalent, yearlyEquivalent } from "@/lib/finance/recurring";
import { SERVICE_GROUP_LABEL } from "@/lib/finance/merchants";
import { addDays, daysBetween, toISODate } from "@/lib/dates";

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: "Active",
  trial: "Free trial",
  cancellation_pending: "Cancellation pending",
  cancelled: "Cancelled",
  paused: "Paused",
  expired: "Expired",
};

export const STATUS_TONE: Record<SubscriptionStatus, "positive" | "accent" | "warning" | "neutral" | "danger"> = {
  active: "positive",
  trial: "accent",
  cancellation_pending: "warning",
  cancelled: "neutral",
  paused: "neutral",
  expired: "neutral",
};

export const CYCLE_UNIT: Record<BillingCycle, string> = {
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  semiannual: "6 months",
  yearly: "year",
  unknown: "period",
};

export const CYCLE_LABEL: Record<BillingCycle, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Every 6 months",
  yearly: "Yearly",
  unknown: "Unknown",
};

export const SOURCE_LABEL: Record<Subscription["detection_source"], string> = {
  bank: "Bank transactions",
  email: "Email",
  manual: "Added manually",
  demo: "Sample data",
};

/** Categories that are fixed costs / bills rather than optional services. */
export const BILL_CATEGORIES = new Set(["bills", "housing"]);

export const GENERIC_CANCEL_STEPS = [
  "Sign in to your account on the provider's website or app and open Account, Billing or Subscription settings.",
  "Choose Cancel (or turn off auto-renew) and follow every confirmation screen until you see a final confirmation.",
  "If you subscribed through Apple, Google Play, your telecom operator or another bundle, cancel there instead.",
  "Keep the confirmation email or reference number, then mark the cancellation as confirmed here.",
  "Check your next bank statement to make sure no new charge appears.",
];

export function isBill(s: Pick<Subscription, "category_id">): boolean {
  return BILL_CATEGORIES.has(s.category_id ?? "");
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** PostgREST may return numerics as strings; normalise once at the boundary. */
export function normalizeSubscription(row: Record<string, unknown>): Subscription {
  const s = row as unknown as Subscription;
  return {
    ...s,
    amount: num(row.amount),
    last_payment_amount: num(row.last_payment_amount),
    previous_amount: num(row.previous_amount),
    detection_confidence: num(row.detection_confidence),
    charge_count: Number(row.charge_count ?? 0),
  };
}

export function cancelSteps(s: Pick<Subscription, "cancel_instructions">): string[] {
  const steps = (s.cancel_instructions ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return steps.length ? steps : GENERIC_CANCEL_STEPS;
}

/** Still costs money (or will): active, pending cancellation, or a trial that converts. */
export function isLive(s: Pick<Subscription, "status" | "dismissed">): boolean {
  return !s.dismissed && (s.status === "active" || s.status === "cancellation_pending" || s.status === "trial" || s.status === "paused");
}

export function isCharging(s: Pick<Subscription, "status" | "dismissed">): boolean {
  return !s.dismissed && (s.status === "active" || s.status === "cancellation_pending");
}

export interface Totals {
  monthly: number;
  yearly: number;
  monthlySubscriptions: number;
  monthlyBills: number;
  countSubscriptions: number;
  countBills: number;
  trialCount: number;
  trialMonthlyIfKept: number;
  pendingCount: number;
  cancelledYearlySavings: number;
}

export function computeTotals(subs: Subscription[]): Totals {
  const t: Totals = {
    monthly: 0,
    yearly: 0,
    monthlySubscriptions: 0,
    monthlyBills: 0,
    countSubscriptions: 0,
    countBills: 0,
    trialCount: 0,
    trialMonthlyIfKept: 0,
    pendingCount: 0,
    cancelledYearlySavings: 0,
  };
  for (const s of subs) {
    if (s.dismissed) continue;
    const m = monthlyEquivalent(s.amount, s.billing_cycle);
    if (isCharging(s)) {
      t.monthly += m;
      if (isBill(s)) {
        t.monthlyBills += m;
        t.countBills++;
      } else {
        t.monthlySubscriptions += m;
        t.countSubscriptions++;
      }
      if (s.status === "cancellation_pending") t.pendingCount++;
    } else if (s.status === "trial") {
      t.trialCount++;
      t.trialMonthlyIfKept += m;
    } else if (s.status === "cancelled") {
      t.cancelledYearlySavings += yearlyEquivalent(s.amount, s.billing_cycle);
    }
  }
  t.yearly = t.monthly * 12;
  return t;
}

export interface RenewalItem {
  subscription: Subscription;
  date: string;
  kind: "renewal" | "trial_conversion";
  amount: number | null;
  daysAway: number;
}

/** Renewals (and trial conversions) in [today, today + days], soonest first. */
export function renewalsWithin(subs: Subscription[], days: number, today = new Date()): RenewalItem[] {
  const from = toISODate(today);
  const until = toISODate(addDays(today, days));
  const items: RenewalItem[] = [];
  for (const s of subs) {
    if (s.dismissed) continue;
    if (s.status === "trial" && s.trial_ends_at && s.trial_ends_at >= from && s.trial_ends_at <= until) {
      items.push({ subscription: s, date: s.trial_ends_at, kind: "trial_conversion", amount: s.amount, daysAway: daysBetween(from, s.trial_ends_at) });
      continue;
    }
    if (!isCharging(s) || !s.next_payment_date) continue;
    if (s.next_payment_date >= from && s.next_payment_date <= until) {
      items.push({ subscription: s, date: s.next_payment_date, kind: "renewal", amount: s.amount, daysAway: daysBetween(from, s.next_payment_date) });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.subscription.name.localeCompare(b.subscription.name));
}

export interface Charge {
  id: string;
  booked_at: string;
  amount: number; // signed, negative = charge
  subscription_id?: string | null;
  merchant_key?: string | null;
}

export interface PriceChange {
  from: number;
  to: number;
  date: string;
}

/** Most recent change in the charged amount, from oldest→newest charge history. */
export function latestPriceChange(charges: Charge[]): PriceChange | null {
  const out = charges
    .filter((c) => c.amount < 0)
    .sort((a, b) => a.booked_at.localeCompare(b.booked_at))
    .map((c) => ({ date: c.booked_at, amount: Math.round(-c.amount * 100) / 100 }));
  for (let i = out.length - 1; i > 0; i--) {
    const prev = out[i - 1].amount;
    const cur = out[i].amount;
    if (Math.abs(cur - prev) / prev > 0.01) return { from: prev, to: cur, date: out[i].date };
  }
  return null;
}

/** Price change from stored detection fields, or from charge history as a fallback. */
export function priceChangeFor(s: Subscription, charges: Charge[] = []): PriceChange | null {
  if (s.previous_amount && s.amount && s.price_changed_at && s.previous_amount !== s.amount) {
    return { from: s.previous_amount, to: s.amount, date: s.price_changed_at };
  }
  return latestPriceChange(charges);
}

export function possiblyForgotten(s: Subscription, today = new Date()): boolean {
  if (s.dismissed || s.status !== "active" || isBill(s)) return false;
  const cutoff = addDays(today, -90).toISOString();
  const started = s.started_at ?? s.created_at.slice(0, 10);
  if (started > toISODate(addDays(today, -90))) return false;
  const reviewedRecently = s.last_reviewed_at !== null && s.last_reviewed_at > cutoff;
  const emailedRecently = s.last_email_at !== null && s.last_email_at > cutoff;
  return !reviewedRecently && !emailedRecently;
}

export type AttentionKind =
  | "charged_after_cancel"
  | "trial_ending"
  | "price_increase"
  | "duplicate"
  | "cancellation_pending"
  | "overdue"
  | "review"
  | "forgotten";

export interface AttentionItem {
  kind: AttentionKind;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  subscriptions: { id: string; name: string }[];
}

export interface AttentionContext {
  today?: Date;
  chargesBySubscription?: Map<string, Charge[]>;
  /** Charges booked after a confirmed cancellation, keyed by subscription id. */
  chargesAfterCancel?: Map<string, Charge[]>;
  /** Cancellation-confirmation emails, keyed by merchant_key. */
  cancellationEmails?: Map<string, { id: string; received_at: string }[]>;
  formatMoney?: (n: number) => string;
}

const ref = (s: Subscription) => ({ id: s.id, name: s.name });

export function computeAttention(subs: Subscription[], ctx: AttentionContext = {}): AttentionItem[] {
  const today = ctx.today ?? new Date();
  const fmt = ctx.formatMoney ?? ((n: number) => `€${n.toFixed(2)}`);
  const todayIso = toISODate(today);
  const items: AttentionItem[] = [];
  const visible = subs.filter((s) => !s.dismissed);

  for (const s of visible) {
    const after = ctx.chargesAfterCancel?.get(s.id) ?? [];
    if (s.status === "cancelled" && after.length) {
      const total = after.reduce((a, c) => a - c.amount, 0);
      items.push({
        kind: "charged_after_cancel",
        severity: "critical",
        title: `${s.name} charged you after you confirmed the cancellation`,
        detail: `${after.length} charge${after.length === 1 ? "" : "s"} totalling ${fmt(total)}. Contact the provider with your cancellation reference, or dispute it with your bank.`,
        subscriptions: [ref(s)],
      });
    }
  }

  const trials = visible.filter((s) => s.status === "trial" && s.trial_ends_at && s.trial_ends_at >= todayIso && daysBetween(todayIso, s.trial_ends_at) <= 14);
  for (const s of trials) {
    const days = daysBetween(todayIso, s.trial_ends_at!);
    items.push({
      kind: "trial_ending",
      severity: days <= 3 ? "critical" : "warning",
      title: `${s.name} free trial ends ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}`,
      detail: s.amount ? `It converts to ${fmt(s.amount)} per ${CYCLE_UNIT[s.billing_cycle]} unless you cancel before then.` : "It converts to a paid plan unless you cancel before then.",
      subscriptions: [ref(s)],
    });
  }

  for (const s of visible) {
    if (!isCharging(s)) continue;
    const change = priceChangeFor(s, ctx.chargesBySubscription?.get(s.id));
    if (change && change.to > change.from && daysBetween(change.date, todayIso) <= 120) {
      items.push({
        kind: "price_increase",
        severity: "warning",
        title: `${s.name} raised its price by ${Math.round(((change.to - change.from) / change.from) * 100)}%`,
        detail: `${fmt(change.from)} → ${fmt(change.to)} per ${CYCLE_UNIT[s.billing_cycle]}, that's ${fmt(yearlyEquivalent(change.to - change.from, s.billing_cycle))} more per year.`,
        subscriptions: [ref(s)],
      });
    }
  }

  for (const g of findSimilarServices(visible)) {
    const subsInGroup = g.subscriptions.map((x) => visible.find((s) => s.id === x.id)!).filter(Boolean);
    const monthly = subsInGroup.reduce((a, s) => a + monthlyEquivalent(s.amount, s.billing_cycle), 0);
    items.push({
      kind: "duplicate",
      severity: "warning",
      title: `Possible overlap: ${subsInGroup.map((s) => s.name).join(" + ")}`,
      detail: `These are all ${SERVICE_GROUP_LABEL[g.group]} services, ${fmt(monthly)} per month together. Keep them if you use each one.`,
      subscriptions: subsInGroup.map(ref),
    });
  }

  for (const s of visible.filter((x) => x.status === "cancellation_pending")) {
    const emails = (ctx.cancellationEmails?.get(s.merchant_key) ?? []).filter((e) => !s.cancellation_requested_at || e.received_at >= s.cancellation_requested_at.slice(0, 10));
    const deadline = s.cancellation_deadline ? ` Deadline: ${s.cancellation_deadline}.` : "";
    items.push({
      kind: "cancellation_pending",
      severity: "info",
      title: emails.length ? `${s.name}: a cancellation email arrived - confirm it?` : `${s.name}: waiting for cancellation confirmation`,
      detail: emails.length
        ? "We found what looks like a confirmation email. Review it and mark the cancellation as confirmed if it's correct."
        : `Requested but not confirmed yet - it may still charge you.${deadline}`,
      subscriptions: [ref(s)],
    });
  }

  for (const s of visible) {
    if (s.status !== "active" || !s.next_payment_date) continue;
    const late = daysBetween(s.next_payment_date, todayIso);
    if (late > 7) {
      items.push({
        kind: "overdue",
        severity: "info",
        title: `${s.name}: expected charge hasn't appeared`,
        detail: `It was due ${late} days ago. It may have been cancelled elsewhere, moved to another card, or the date shifted.`,
        subscriptions: [ref(s)],
      });
    }
  }

  const review = visible.filter((s) => !s.user_confirmed && s.detection_source !== "manual" && (s.status === "active" || s.status === "trial"));
  if (review.length) {
    items.push({
      kind: "review",
      severity: "info",
      title: `${review.length} detected recurring payment${review.length === 1 ? "" : "s"} to review`,
      detail: "Found automatically in your bank transactions or emails. Confirm the ones that are right, dismiss the rest.",
      subscriptions: review.map(ref),
    });
  }

  const forgotten = visible.filter((s) => possiblyForgotten(s, today));
  if (forgotten.length) {
    const monthly = forgotten.reduce((a, s) => a + monthlyEquivalent(s.amount, s.billing_cycle), 0);
    items.push({
      kind: "forgotten",
      severity: "info",
      title: `${forgotten.length} subscription${forgotten.length === 1 ? "" : "s"} you might have forgotten about`,
      detail: `Not reviewed in 90+ days and no emails from them recently (${fmt(monthly)}/month). We can't see whether you actually use them - mark the ones you still use as reviewed.`,
      subscriptions: forgotten.map(ref),
    });
  }

  const order: Record<AttentionItem["severity"], number> = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

export interface TimelineEntry {
  date: string;
  label: string;
  detail?: string;
  tone: "neutral" | "positive" | "warning" | "accent";
  future?: boolean;
}

export function buildTimeline(s: Subscription, opts: { priceChange?: PriceChange | null; today?: Date; formatMoney?: (n: number) => string } = {}): TimelineEntry[] {
  const fmt = opts.formatMoney ?? ((n: number) => `€${n.toFixed(2)}`);
  const todayIso = toISODate(opts.today ?? new Date());
  const entries: TimelineEntry[] = [];
  if (s.started_at) entries.push({ date: s.started_at, label: s.detection_source === "email" ? "First seen in email" : "First charge", tone: "neutral" });
  entries.push({
    date: s.created_at,
    label: s.detection_source === "manual" ? "Added manually" : `Detected from ${SOURCE_LABEL[s.detection_source].toLowerCase()}`,
    detail: s.detection_confidence ? `${Math.round(s.detection_confidence * 100)}% confidence` : undefined,
    tone: "accent",
  });
  if (opts.priceChange) {
    entries.push({
      date: opts.priceChange.date,
      label: opts.priceChange.to > opts.priceChange.from ? "Price increased" : "Price decreased",
      detail: `${fmt(opts.priceChange.from)} → ${fmt(opts.priceChange.to)}`,
      tone: opts.priceChange.to > opts.priceChange.from ? "warning" : "positive",
    });
  }
  if (s.last_payment_date) entries.push({ date: s.last_payment_date, label: "Last payment", detail: s.last_payment_amount ? fmt(s.last_payment_amount) : undefined, tone: "neutral" });
  if (s.last_reviewed_at) entries.push({ date: s.last_reviewed_at, label: "Reviewed by you", tone: "positive" });
  if (s.cancellation_requested_at) entries.push({ date: s.cancellation_requested_at, label: "Cancellation requested", detail: "Not confirmed by the provider yet at that point", tone: "warning" });
  if (s.cancellation_confirmed_at) entries.push({ date: s.cancellation_confirmed_at, label: "Cancellation confirmed by you", detail: s.cancellation_reference ?? undefined, tone: "positive" });
  if (s.trial_ends_at) entries.push({ date: s.trial_ends_at, label: "Free trial ends", tone: "warning", future: s.trial_ends_at >= todayIso });
  if (s.cancellation_deadline) entries.push({ date: s.cancellation_deadline, label: "Cancellation deadline", tone: "warning", future: s.cancellation_deadline >= todayIso });
  if (isCharging(s) && s.next_payment_date) entries.push({ date: s.next_payment_date, label: "Next payment", detail: s.amount ? fmt(s.amount) : undefined, tone: "neutral", future: s.next_payment_date >= todayIso });
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}
