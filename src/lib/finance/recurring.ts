import type { BillingCycle, TransactionKind } from "@/lib/types";
import { addDays, addMonths, parseISODate, toISODate } from "@/lib/dates";
import { merchantByKey, type ServiceGroup } from "./merchants";

export interface RecurringInput {
  id: string;
  booked_at: string;
  amount: number;
  kind: TransactionKind;
  merchant: string | null;
  merchant_key: string | null;
  category_id: string | null;
}

export interface RecurringCandidate {
  merchantKey: string;
  name: string;
  categoryId: string;
  cycle: BillingCycle;
  amount: number; // latest charge, positive
  previousAmount: number | null; // the price before the most recent price change
  priceChangedAt: string | null; // first charge at the current price
  priceIncrease: boolean;
  lastDate: string;
  nextDate: string;
  firstDate: string;
  chargeCount: number;
  confidence: number;
  transactionIds: string[];
  isKnownSubscription: boolean;
  group?: ServiceGroup;
}

const CYCLES: { cycle: BillingCycle; min: number; max: number; days: number; minCount: number; tolerance: number }[] = [
  { cycle: "weekly", min: 6, max: 8, days: 7, minCount: 4, tolerance: 2 },
  { cycle: "monthly", min: 25, max: 35, days: 30, minCount: 3, tolerance: 5 },
  { cycle: "quarterly", min: 84, max: 98, days: 91, minCount: 2, tolerance: 10 },
  { cycle: "semiannual", min: 172, max: 192, days: 182, minCount: 2, tolerance: 14 },
  { cycle: "yearly", min: 350, max: 380, days: 365, minCount: 2, tolerance: 20 },
];

// Everyday spending at the same shop is not a subscription.
const NON_RECURRING_CATEGORIES = new Set(["groceries", "restaurants", "shopping", "transport", "cash", "travel", "entertainment"]);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function nextOccurrence(last: string, cycle: BillingCycle, medianDays?: number): string {
  const d = parseISODate(last);
  switch (cycle) {
    case "weekly":
      return toISODate(addDays(d, 7));
    case "monthly":
      // 4-weekly plans (e.g. gyms) bill every 28 days rather than monthly.
      return toISODate(medianDays && medianDays <= 29 ? addDays(d, Math.round(medianDays)) : addMonths(d, 1));
    case "quarterly":
      return toISODate(addMonths(d, 3));
    case "semiannual":
      return toISODate(addMonths(d, 6));
    case "yearly":
      return toISODate(addMonths(d, 12));
    default:
      return toISODate(addMonths(d, 1));
  }
}

export function monthlyEquivalent(amount: number | null | undefined, cycle: BillingCycle): number {
  const a = amount ?? 0;
  switch (cycle) {
    case "weekly":
      return (a * 52) / 12;
    case "quarterly":
      return a / 3;
    case "semiannual":
      return a / 6;
    case "yearly":
      return a / 12;
    default:
      return a;
  }
}

export function yearlyEquivalent(amount: number | null | undefined, cycle: BillingCycle): number {
  return monthlyEquivalent(amount, cycle) * 12;
}

/**
 * Detect recurring charges from a user's transaction history. Groups outflows
 * by merchant, then looks for a stable interval and a stable amount.
 */
export function detectRecurring(txs: RecurringInput[], today = new Date()): RecurringCandidate[] {
  const groups = new Map<string, RecurringInput[]>();
  for (const t of txs) {
    if (t.amount >= 0 || !t.merchant_key) continue;
    if (t.kind !== "expense" && t.kind !== "fee") continue;
    const list = groups.get(t.merchant_key) ?? [];
    list.push(t);
    groups.set(t.merchant_key, list);
  }

  const out: RecurringCandidate[] = [];
  for (const [key, list] of groups) {
    const entry = merchantByKey(key);
    const isKnownSubscription = Boolean(entry?.subscription);
    const categoryId = entry?.category ?? list[list.length - 1].category_id ?? "other";
    if (!isKnownSubscription && NON_RECURRING_CATEGORIES.has(categoryId)) continue;
    if (list.length < 2) continue;

    const sorted = [...list].sort((a, b) => a.booked_at.localeCompare(b.booked_at));
    // Collapse same-day duplicates (e.g. split charges) into one charge.
    const charges: RecurringInput[] = [];
    for (const t of sorted) {
      const prev = charges[charges.length - 1];
      if (prev && prev.booked_at === t.booked_at) {
        charges[charges.length - 1] = { ...prev, amount: prev.amount + t.amount };
      } else charges.push(t);
    }
    if (charges.length < 2) continue;

    const intervals: number[] = [];
    for (let i = 1; i < charges.length; i++) {
      intervals.push(Math.round((parseISODate(charges[i].booked_at).getTime() - parseISODate(charges[i - 1].booked_at).getTime()) / 86_400_000));
    }
    const medianInterval = median(intervals);
    const spec = CYCLES.find((c) => medianInterval >= c.min && medianInterval <= c.max);
    if (!spec) continue;

    const minCount = isKnownSubscription ? Math.max(2, spec.minCount - 1) : spec.minCount;
    if (charges.length < minCount) continue;

    const regular = intervals.filter((d) => Math.abs(d - medianInterval) <= spec.tolerance).length / intervals.length;
    if (regular < 0.7) continue;

    const amounts = charges.map((c) => -c.amount);
    const latest = amounts[amounts.length - 1];
    const med = median(amounts);
    // Most recent price change: walk back while charges match the current price.
    let changeIdx = -1;
    for (let i = amounts.length - 2; i >= 0; i--) {
      if (Math.abs(amounts[i] - latest) / latest > 0.01) {
        changeIdx = i;
        break;
      }
    }
    const previous = changeIdx >= 0 ? amounts[changeIdx] : null;
    const priceChangedAt = changeIdx >= 0 ? charges[changeIdx + 1].booked_at : null;
    // Amount stability, tolerating one step change (price increase / decrease).
    const stable = amounts.filter((a) => Math.abs(a - med) / med <= 0.2).length / amounts.length;
    const stepChange = previous !== null;
    if (stable < 0.6 && !stepChange) continue;

    const lastDate = charges[charges.length - 1].booked_at;
    const nextDate = nextOccurrence(lastDate, spec.cycle, medianInterval);

    // A charge stream that stopped long ago is not an active subscription.
    const overdueDays = (today.getTime() - parseISODate(nextDate).getTime()) / 86_400_000;
    if (overdueDays > Math.max(spec.tolerance * 3, 21)) continue;

    let confidence = 0.35;
    confidence += Math.min(charges.length, 6) * 0.06;
    confidence += regular * 0.15;
    confidence += stable * 0.1;
    if (isKnownSubscription) confidence += 0.15;
    confidence = Math.min(0.99, Number(confidence.toFixed(3)));

    out.push({
      merchantKey: key,
      name: entry?.name ?? charges[charges.length - 1].merchant ?? key,
      categoryId: isKnownSubscription && entry?.category === "subscriptions" ? "subscriptions" : categoryId,
      cycle: spec.cycle,
      amount: Number(latest.toFixed(2)),
      previousAmount: previous !== null ? Number(previous.toFixed(2)) : null,
      priceChangedAt,
      priceIncrease: previous !== null && latest > previous,
      lastDate,
      nextDate,
      firstDate: charges[0].booked_at,
      chargeCount: charges.length,
      confidence,
      transactionIds: sorted.map((t) => t.id),
      isKnownSubscription,
      group: entry?.subscription?.group,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

export interface SubscriptionLike {
  id: string;
  name: string;
  merchant_key: string;
  status: string;
  amount: number | null;
  billing_cycle: BillingCycle;
}

export interface DuplicateGroup {
  group: ServiceGroup;
  subscriptions: SubscriptionLike[];
}

const DUPLICATE_GROUPS = new Set<ServiceGroup>([
  "video_streaming",
  "music_streaming",
  "cloud_storage",
  "ai_assistant",
  "vpn",
  "audiobooks",
  "food_delivery_plus",
  "fitness",
  "design",
]);

/** Active subscriptions that cover the same need (e.g. Spotify + Deezer). */
export function findSimilarServices(subs: SubscriptionLike[]): DuplicateGroup[] {
  const byGroup = new Map<ServiceGroup, SubscriptionLike[]>();
  for (const s of subs) {
    if (s.status !== "active" && s.status !== "trial") continue;
    const group = merchantByKey(s.merchant_key)?.subscription?.group;
    if (!group || !DUPLICATE_GROUPS.has(group)) continue;
    const list = byGroup.get(group) ?? [];
    list.push(s);
    byGroup.set(group, list);
  }
  return [...byGroup.entries()].filter(([, list]) => list.length > 1).map(([group, list]) => ({ group, subscriptions: list }));
}
