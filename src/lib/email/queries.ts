// Holds no secrets: queries go through the caller's row-level-security client, so this
// also runs in the browser-only GitHub Pages edition (against on-device data).
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { CalendarEvent, EmailCategory, EmailRecord, Subscription, Transaction } from "@/lib/types";
import { GOOGLE_SCOPES } from "@/lib/integrations/google/scopes";
import { matchMerchant } from "@/lib/finance/merchants";
import { addDays, toISODate } from "@/lib/dates";

export type EmailTab = "all" | "important" | "receipts" | "purchases" | "bookings";

export const EMAIL_TABS: { key: EmailTab; label: string; href: string }[] = [
  { key: "all", label: "All", href: "/emails" },
  { key: "important", label: "Important", href: "/emails/important" },
  { key: "receipts", label: "Receipts", href: "/emails/receipts" },
  { key: "purchases", label: "Purchases", href: "/emails/purchases" },
  { key: "bookings", label: "Bookings", href: "/emails/bookings" },
];

export const PURCHASE_CATEGORIES: EmailCategory[] = ["purchase", "order", "shipping"];
export const BOOKING_CATEGORIES: EmailCategory[] = ["booking", "travel", "appointment"];
const SPEND_CATEGORIES: EmailCategory[] = ["receipt", "order", "purchase"];

// PostgREST builder generics explode TypeScript's instantiation depth when passed
// through a helper, so the helper is typed loosely and callers keep their own types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Filterable = any;
function applyTab<Q>(query: Q, tab: EmailTab): Q {
  const q = query as Filterable;
  switch (tab) {
    case "important":
      return q.or("is_important.eq.true,category.in.(bill,appointment,important)");
    case "receipts":
      return q.eq("category", "receipt");
    case "purchases":
      return q.in("category", PURCHASE_CATEGORIES);
    case "bookings":
      return q.in("category", BOOKING_CATEGORIES);
    default:
      return q;
  }
}

/** Search term safe to embed in a PostgREST `or=(...)` filter. */
export function cleanTerm(q: string | undefined | null): string {
  return (q ?? "").replace(/[^\p{L}\p{N}\s.@&'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export interface EmailFilters {
  tab: EmailTab;
  q?: string;
  category?: EmailCategory;
  merchantKey?: string;
  /** Only emails from this mailbox (connection id). */
  connectionId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function listEmails(supabase: AppSupabaseClient, f: EmailFilters) {
  const pageSize = Math.min(f.pageSize ?? 40, 100);
  const page = Math.max(1, f.page ?? 1);
  let q = supabase.from("emails").select("*", { count: "exact" }).order("received_at", { ascending: false });
  q = applyTab(q, f.tab);
  if (f.category) q = q.eq("category", f.category);
  if (f.merchantKey) q = q.eq("merchant_key", f.merchantKey);
  if (f.connectionId) q = q.eq("connection_id", f.connectionId);
  if (f.from) q = q.gte("received_at", `${f.from}T00:00:00`);
  if (f.to) q = q.lte("received_at", `${f.to}T23:59:59`);
  const term = cleanTerm(f.q);
  if (term) {
    // Full-text (plainto_tsquery over subject/sender/merchant/snippet/order no.) plus substring fallbacks.
    q = q.or(
      [
        `search.plfts(simple).${term.includes(" ") ? `"${term}"` : term}`,
        `subject.ilike.%${term}%`,
        `merchant.ilike.%${term}%`,
        `from_name.ilike.%${term}%`,
        `from_email.ilike.%${term}%`,
        `order_number.ilike.%${term}%`,
      ].join(","),
    );
  }
  q = q.range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw new Error(`Failed to load emails: ${error.message}`);
  return { rows: (data ?? []) as EmailRecord[], count: count ?? 0, page, pageSize };
}

export async function tabCounts(supabase: AppSupabaseClient): Promise<Record<EmailTab, number>> {
  const entries = await Promise.all(
    EMAIL_TABS.map(async (t) => {
      const { count } = await applyTab(supabase.from("emails").select("id", { count: "exact", head: true }), t.key);
      return [t.key, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<EmailTab, number>;
}

export interface Mailbox {
  id: string;
  /** The account's email address. */
  label: string;
  last_synced_at: string | null;
  status: string;
  last_error: string | null;
}

/** Every connected mailbox (one per Google account with Gmail access), oldest connection first. */
export async function gmailConnections(supabase: AppSupabaseClient): Promise<Mailbox[]> {
  const { data } = await supabase.from("connections").select("id, label, scopes, last_synced_at, status, last_error, created_at").eq("provider", "google").order("created_at");
  return (data ?? [])
    .filter((x) => (x.scopes as string[]).includes(GOOGLE_SCOPES.gmail) && x.status !== "revoked")
    .map((c) => ({ id: c.id, label: c.label, last_synced_at: c.last_synced_at, status: c.status, last_error: c.last_error }));
}

export async function gmailConnected(supabase: AppSupabaseClient): Promise<Mailbox | null> {
  return (await gmailConnections(supabase))[0] ?? null;
}

export interface EmailDetail {
  email: EmailRecord;
  matchedTransaction: Pick<Transaction, "id" | "booked_at" | "amount" | "currency" | "merchant" | "is_demo"> | null;
  events: Pick<CalendarEvent, "id" | "title" | "starts_at" | "kind" | "status">[];
  subscription: Pick<Subscription, "id" | "name" | "status" | "amount" | "currency" | "billing_cycle"> | null;
}

export async function getEmailDetail(supabase: AppSupabaseClient, id: string): Promise<EmailDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabase.from("emails").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const email = data as EmailRecord;
  const received = new Date(email.received_at);
  const [tx, ev, sub] = await Promise.all([
    email.merchant_key && email.amount
      ? supabase
          .from("transactions")
          .select("id, booked_at, amount, currency, merchant, is_demo")
          .eq("merchant_key", email.merchant_key)
          .gte("booked_at", toISODate(addDays(received, -7)))
          .lte("booked_at", toISODate(addDays(received, 7)))
          .in("amount", [-Number(email.amount), Number(email.amount)])
          .limit(1)
      : Promise.resolve({ data: [] }),
    supabase.from("events").select("id, title, starts_at, kind, status").eq("email_id", email.id).limit(3),
    email.merchant_key
      ? supabase.from("subscriptions").select("id, name, status, amount, currency, billing_cycle").eq("merchant_key", email.merchant_key).eq("dismissed", false).limit(1)
      : Promise.resolve({ data: [] }),
  ]);
  return {
    email,
    matchedTransaction: ((tx.data ?? [])[0] as EmailDetail["matchedTransaction"]) ?? null,
    events: (ev.data ?? []) as EmailDetail["events"],
    subscription: ((sub.data ?? [])[0] as EmailDetail["subscription"]) ?? null,
  };
}

// --------------------------------------------------------------- answers

export interface MerchantAnswer {
  merchant: string;
  merchantKey: string;
  year: number;
  emailSpend: number;
  emailCount: number;
  emailRefunds: number;
  bankSpend: number | null;
  bankCount: number;
  lastEmail: { id: string; date: string; amount: number | null; currency: string | null; subject: string | null } | null;
  lastTransaction: { date: string; amount: number; currency: string } | null;
  currency: string;
}

/** "How much did I spend at <merchant> this year?" and "When did I last buy from <store>?" */
export async function merchantAnswer(supabase: AppSupabaseClient, q: string, today = new Date()): Promise<MerchantAnswer | null> {
  const term = cleanTerm(q);
  if (term.length < 2) return null;
  let key = matchMerchant(term)?.key ?? null;
  let name = matchMerchant(term)?.name ?? null;
  if (!key) {
    const { data } = await supabase.from("emails").select("merchant, merchant_key").ilike("merchant", `%${term}%`).not("merchant_key", "is", null).limit(50);
    const counts = new Map<string, { n: number; name: string }>();
    for (const r of (data ?? []) as { merchant: string; merchant_key: string }[]) {
      const c = counts.get(r.merchant_key) ?? { n: 0, name: r.merchant };
      c.n++;
      counts.set(r.merchant_key, c);
    }
    const best = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    if (!best) return null;
    key = best[0];
    name = best[1].name;
  }
  const year = today.getFullYear();
  const yearStart = `${year}-01-01`;
  const [emailsRes, txRes] = await Promise.all([
    supabase
      .from("emails")
      .select("id, received_at, amount, currency, subject, order_number, category, extracted")
      .eq("merchant_key", key)
      .in("category", SPEND_CATEGORIES)
      .order("received_at", { ascending: false })
      .limit(500),
    supabase
      .from("transactions")
      .select("booked_at, amount, currency, kind")
      .eq("merchant_key", key)
      .in("kind", ["expense", "refund", "withdrawal", "fee"])
      .order("booked_at", { ascending: false })
      .limit(1000),
  ]);
  const emails = (emailsRes.data ?? []) as (Pick<EmailRecord, "id" | "received_at" | "amount" | "currency" | "subject" | "order_number" | "category" | "extracted">)[];
  const txs = (txRes.data ?? []) as Pick<Transaction, "booked_at" | "amount" | "currency" | "kind">[];
  if (emails.length === 0 && txs.length === 0) return null;

  // An order confirmation and its receipt describe the same purchase: count each order number once.
  const perOrder = new Map<string, number>();
  let emailRefunds = 0;
  let emailCount = 0;
  for (const e of emails) {
    if (e.received_at < yearStart || e.amount === null) continue;
    const amount = Number(e.amount);
    if ((e.extracted as { refund?: boolean })?.refund) {
      emailRefunds += amount;
      continue;
    }
    const k = e.order_number ?? e.id;
    perOrder.set(k, Math.max(perOrder.get(k) ?? 0, amount));
    emailCount++;
  }
  const emailSpend = [...perOrder.values()].reduce((a, b) => a + b, 0) - emailRefunds;
  const yearTx = txs.filter((t) => t.booked_at >= yearStart);
  const lastPurchase = emails.find((e) => !(e.extracted as { refund?: boolean })?.refund);
  const lastTx = txs.find((t) => Number(t.amount) < 0);
  return {
    merchant: name ?? key,
    merchantKey: key,
    year,
    emailSpend: Math.round(emailSpend * 100) / 100,
    emailCount,
    emailRefunds,
    bankSpend: yearTx.length ? Math.round(yearTx.reduce((a, t) => a - Number(t.amount), 0) * 100) / 100 : null,
    bankCount: yearTx.length,
    lastEmail: lastPurchase
      ? { id: lastPurchase.id, date: lastPurchase.received_at, amount: lastPurchase.amount === null ? null : Number(lastPurchase.amount), currency: lastPurchase.currency, subject: lastPurchase.subject }
      : null,
    lastTransaction: lastTx ? { date: lastTx.booked_at, amount: -Number(lastTx.amount), currency: lastTx.currency } : null,
    currency: emails.find((e) => e.currency)?.currency ?? txs[0]?.currency ?? "EUR",
  };
}

export interface InboxAnswers {
  upcomingPayments: EmailRecord[];
  trialsEnding: (EmailRecord & { trialEnd: string })[];
  signedUp: EmailRecord[];
  upcomingBookings: EmailRecord[];
  deliveries: (EmailRecord & { deliveryDate: string })[];
  topMerchants: { merchant: string; merchantKey: string; total: number; count: number; currency: string }[];
  receiptsThisMonth: { total: number; count: number };
  receiptsThisYear: { total: number; count: number };
}

export async function inboxAnswers(supabase: AppSupabaseClient, today = new Date()): Promise<InboxAnswers> {
  const todayIso = toISODate(today);
  const yearStart = `${today.getFullYear()}-01-01`;
  const monthStart = todayIso.slice(0, 8) + "01";
  const [bills, trials, signups, bookings, deliveries, receipts] = await Promise.all([
    supabase.from("emails").select("*").eq("category", "bill").gte("due_date", todayIso).order("due_date").limit(6),
    supabase.from("emails").select("*").eq("category", "trial").gte("extracted->>trial_end_date", todayIso).limit(20),
    supabase.from("emails").select("*").in("category", ["subscription", "trial"]).gte("received_at", addDays(today, -365).toISOString()).order("received_at", { ascending: false }).limit(40),
    supabase.from("emails").select("*").in("category", BOOKING_CATEGORIES).gte("event_start", today.toISOString()).order("event_start").limit(6),
    supabase.from("emails").select("*").in("category", ["shipping", "order"]).gte("extracted->>delivery_date", todayIso).order("received_at", { ascending: false }).limit(10),
    supabase.from("emails").select("merchant, merchant_key, amount, currency, received_at, extracted").in("category", SPEND_CATEGORIES).gte("received_at", `${yearStart}T00:00:00`).not("amount", "is", null).limit(2000),
  ]);

  const trialRows = ((trials.data ?? []) as EmailRecord[])
    .map((e) => ({ ...e, trialEnd: String((e.extracted as { trial_end_date?: string }).trial_end_date) }))
    .sort((a, b) => a.trialEnd.localeCompare(b.trialEnd));
  const seenTrial = new Set<string>();
  const trialsEnding = trialRows.filter((t) => (t.merchant_key ? !seenTrial.has(t.merchant_key) && seenTrial.add(t.merchant_key) : true)).slice(0, 5);

  const seenSignup = new Set<string>();
  const signedUp = ((signups.data ?? []) as EmailRecord[]).filter((e) => {
    const k = e.merchant_key ?? e.id;
    if (seenSignup.has(k)) return false;
    seenSignup.add(k);
    return true;
  });

  const seenDelivery = new Set<string>();
  const deliveryRows = ((deliveries.data ?? []) as EmailRecord[])
    .map((e) => ({ ...e, deliveryDate: String((e.extracted as { delivery_date?: string }).delivery_date) }))
    .filter((e) => {
      // The order confirmation and the carrier's notice describe the same parcel.
      const k = `${e.merchant_key ?? e.id}|${e.deliveryDate}`;
      if (seenDelivery.has(k)) return false;
      seenDelivery.add(k);
      return true;
    })
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));

  const rows = (receipts.data ?? []) as Pick<EmailRecord, "merchant" | "merchant_key" | "amount" | "currency" | "received_at" | "extracted">[];
  const merchants = new Map<string, { merchant: string; merchantKey: string; total: number; count: number; currency: string }>();
  const month = { total: 0, count: 0 };
  const year = { total: 0, count: 0 };
  for (const r of rows) {
    const amount = Number(r.amount) * ((r.extracted as { refund?: boolean })?.refund ? -1 : 1);
    year.total += amount;
    year.count++;
    if (r.received_at >= monthStart) {
      month.total += amount;
      month.count++;
    }
    if (!r.merchant_key) continue;
    const m = merchants.get(r.merchant_key) ?? { merchant: r.merchant ?? r.merchant_key, merchantKey: r.merchant_key, total: 0, count: 0, currency: r.currency ?? "EUR" };
    m.total += amount;
    m.count++;
    merchants.set(r.merchant_key, m);
  }

  return {
    upcomingPayments: (bills.data ?? []) as EmailRecord[],
    trialsEnding,
    signedUp: signedUp.slice(0, 8),
    upcomingBookings: (bookings.data ?? []) as EmailRecord[],
    deliveries: deliveryRows.slice(0, 5),
    topMerchants: [...merchants.values()].filter((m) => m.total > 0).sort((a, b) => b.total - a.total).slice(0, 6),
    receiptsThisMonth: month,
    receiptsThisYear: year,
  };
}
