/**
 * Understands plain-English questions for the built-in assistant: what is
 * being asked (intent), about which period, category and merchant. Pure and
 * deterministic - no AI, no network - so it works with no API key and is
 * unit tested.
 */
import { addDays, addMonths, endOfMonth, parseISODate, startOfMonth, startOfWeek, toISODate } from "@/lib/dates";

export type Intent =
  | "help"
  | "checkup"
  | "email_digest"
  | "emails"
  | "events"
  | "upcoming_payments"
  | "subscriptions_forgotten"
  | "trials"
  | "price_changes"
  | "recurring_biggest"
  | "subscriptions_cost"
  | "subscriptions_list"
  | "budgets"
  | "balance"
  | "income"
  | "savings"
  | "compare"
  | "unusual"
  | "biggest_purchases"
  | "top_merchants"
  | "top_categories"
  | "merchant_spend"
  | "category_spend"
  | "recent_transactions"
  | "spending_total"
  | "sources"
  | "unknown";

export interface Period {
  from: string;
  to: string;
  /** How the user phrased it, e.g. "this month" or "October 2026". */
  label: string;
}

export interface ParsedQuestion {
  intent: Intent;
  /** Past period for spending-type questions (undefined = not stated). */
  period?: Period;
  /** Forward-looking window for upcoming payments / events (undefined = not stated). */
  window?: Period;
  /** Second period for comparisons. */
  comparePeriod?: Period;
  categoryIds?: string[];
  categoryLabel?: string;
  merchant?: string;
  emailCategory?: string;
  emailQuery?: string;
  perMonth?: boolean;
  limit?: number;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_ALIASES: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const NUMBER_WORDS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, couple: 2, few: 3 };

const MONTH_NAME = (i: number) => MONTHS[i][0].toUpperCase() + MONTHS[i].slice(1);
const iso = toISODate;
const range = (from: Date, to: Date, label: string): Period => ({ from: iso(from), to: iso(to), label });
const minDate = (a: Date, b: Date) => (a < b ? a : b);

function toNumber(word: string): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

function monthIndex(word: string): number | null {
  const full = MONTHS.indexOf(word);
  if (full >= 0) return full;
  return MONTH_ALIASES[word] ?? null;
}

const MONTH_RE = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";

/** A named month ("in October", "oct 2025") resolved to the most recent occurrence that isn't in the future. */
function namedMonth(t: string, today: Date): Period | null {
  // "may" is also a verb; only accept it with a preposition or a year.
  const m = new RegExp(`\\b(?:(in|during|for|of|since|from)\\s+)?${MONTH_RE}\\b\\.?(?:\\s+(20\\d{2}))?`).exec(t);
  if (!m) return null;
  if (m[2] === "may" && !m[1] && !m[3]) return null;
  const idx = monthIndex(m[2]);
  if (idx === null) return null;
  let year = m[3] ? Number(m[3]) : today.getFullYear();
  if (!m[3] && new Date(year, idx, 1) > today) year -= 1;
  const start = new Date(year, idx, 1);
  if (m[1] === "since" || m[1] === "from") return range(start, today, `since ${MONTH_NAME(idx)} ${year}`);
  return range(start, minDate(endOfMonth(start), today), `${MONTH_NAME(idx)} ${year}`);
}

/** Past-looking period ("this month", "last 30 days", "in October", "2025"). */
export function parsePeriod(text: string, today: Date): Period | null {
  const t = text.toLowerCase();
  const isoDates = t.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (isoDates && isoDates.length >= 2) {
    const [a, b] = [parseISODate(isoDates[0]), parseISODate(isoDates[1])].sort((x, y) => x.getTime() - y.getTime());
    return range(a, b, `${iso(a)} to ${iso(b)}`);
  }
  if (/\btoday\b/.test(t)) return range(today, today, "today");
  if (/\byesterday\b/.test(t)) return range(addDays(today, -1), addDays(today, -1), "yesterday");

  const rolling = /\b(?:last|past|previous)\s+(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|twelve|couple of|few)\s+(day|week|month|year)s?\b/.exec(t);
  if (rolling) {
    const n = toNumber(rolling[1].replace(" of", "")) ?? 1;
    const unit = rolling[2];
    const from = unit === "day" ? addDays(today, -(n - 1)) : unit === "week" ? addDays(today, -(n * 7 - 1)) : unit === "month" ? addDays(addMonths(today, -n), 1) : addDays(addMonths(today, -12 * n), 1);
    return range(from, today, `the last ${n} ${unit}${n === 1 ? "" : "s"}`);
  }

  if (/\b(this|current) week\b|\bweek so far\b/.test(t)) return range(startOfWeek(today), today, "this week");
  if (/\b(last|previous) week\b/.test(t)) {
    const start = addDays(startOfWeek(today), -7);
    return range(start, addDays(start, 6), "last week");
  }
  if (/\b(this|current) month\b|\bmonth so far\b|\bmonth to date\b|\bmtd\b/.test(t)) return range(startOfMonth(today), today, "this month");
  if (/\b(last|previous) month\b/.test(t)) {
    const start = addMonths(startOfMonth(today), -1);
    return range(start, endOfMonth(start), "last month");
  }
  if (/\b(this|current) year\b|\byear to date\b|\bytd\b|\bso far this year\b/.test(t)) return range(new Date(today.getFullYear(), 0, 1), today, "this year");
  if (/\b(last|previous) year\b/.test(t)) return range(new Date(today.getFullYear() - 1, 0, 1), new Date(today.getFullYear() - 1, 11, 31), "last year");

  const quarter = /\bq([1-4])(?:\s+(20\d{2}))?\b/.exec(t) ?? /\b(first|second|third|fourth) quarter(?:\s+(?:of\s+)?(20\d{2}))?\b/.exec(t);
  if (quarter) {
    const q = /^\d$/.test(quarter[1]) ? Number(quarter[1]) : ["first", "second", "third", "fourth"].indexOf(quarter[1]) + 1;
    let year = quarter[2] ? Number(quarter[2]) : today.getFullYear();
    if (!quarter[2] && new Date(year, (q - 1) * 3, 1) > today) year -= 1;
    const start = new Date(year, (q - 1) * 3, 1);
    return range(start, minDate(endOfMonth(new Date(year, (q - 1) * 3 + 2, 1)), today), `Q${q} ${year}`);
  }

  const month = namedMonth(t, today);
  if (month) return month;

  const year = /\b(?:in|during|for|of)?\s*(20\d{2})\b/.exec(t);
  if (year) {
    const y = Number(year[1]);
    if (y <= today.getFullYear() && y >= today.getFullYear() - 3) return range(new Date(y, 0, 1), minDate(new Date(y, 11, 31), today), String(y));
  }
  if (/\b(all time|ever|in total|overall|since the (start|beginning))\b/.test(t)) return range(addDays(today, -1095), today, "the last 3 years");
  return null;
}

/** Forward-looking window ("next week", "tomorrow", "next 30 days"). */
export function parseWindow(text: string, today: Date): Period | null {
  const t = text.toLowerCase();
  if (/\btomorrow\b/.test(t)) return range(addDays(today, 1), addDays(today, 1), "tomorrow");
  if (/\btoday\b|\btonight\b/.test(t)) return range(today, today, "today");
  const n = /\b(?:next|coming|following)\s+(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|twelve|couple of|few)\s+(day|week|month)s\b/.exec(t);
  if (n) {
    const count = toNumber(n[1].replace(" of", "")) ?? 1;
    const days = n[2] === "day" ? count : n[2] === "week" ? count * 7 : count * 30;
    return range(today, addDays(today, Math.min(days, 120)), `the next ${count} ${n[2]}s`);
  }
  if (/\bthis weekend\b|\bat the weekend\b/.test(t)) {
    const sat = addDays(startOfWeek(today), 5);
    return range(sat < today ? today : sat, addDays(startOfWeek(today), 6), "this weekend");
  }
  if (/\bnext week\b/.test(t)) {
    const start = addDays(startOfWeek(today), 7);
    return range(start, addDays(start, 6), "next week");
  }
  if (/\b(this|current) week\b|\brest of the week\b/.test(t)) return range(today, addDays(startOfWeek(today), 6), "this week");
  if (/\bnext month\b/.test(t)) {
    const start = addMonths(startOfMonth(today), 1);
    return range(start, endOfMonth(start), "next month");
  }
  if (/\b(this|current) month\b|\brest of the month\b|\bend of (the )?month\b/.test(t)) return range(today, endOfMonth(today), "the rest of this month");
  if (/\bsoon\b|\bshortly\b/.test(t)) return range(today, addDays(today, 14), "the next 2 weeks");
  return null;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORY_WORDS: { ids: string[]; label: string; re: RegExp }[] = [
  { ids: ["groceries", "restaurants"], label: "food (groceries and restaurants)", re: /\b(food|eating|meals?)\b/ },
  { ids: ["groceries"], label: "groceries", re: /\b(grocer(y|ies)|supermarkets?)\b/ },
  { ids: ["restaurants"], label: "restaurants and takeaway", re: /\b(restaurants?|eating out|dining|take-?aways?|take-?out|cafes?|coffee|bars?|lunch(es)?)\b/ },
  { ids: ["shopping"], label: "shopping", re: /\b(shopping|clothes|clothing|shoes|electronics)\b/ },
  { ids: ["entertainment"], label: "entertainment", re: /\b(entertainment|cinema|movies?|games?|gaming|concerts?|going out|hobb(y|ies))\b/ },
  { ids: ["transport"], label: "transport", re: /\b(transport|fuel|petrol|diesel|trains?|bus(es)?|trams?|metro|parking|taxis?|commut(e|ing))\b/ },
  { ids: ["travel"], label: "travel", re: /\b(travel|travell?ing|holidays?|vacations?|trips?|flights?|hotels?)\b/ },
  { ids: ["housing"], label: "housing", re: /\b(rent|mortgage|housing)\b/ },
  { ids: ["bills"], label: "bills and utilities", re: /\b(utilit(y|ies)|electricity|energy|gas bill|water|internet|phone|mobile|insurance|telecom)\b/ },
  { ids: ["health"], label: "health and fitness", re: /\b(health|pharmac(y|ies)|doctors?|dentists?|medical|medicine|gym|fitness)\b/ },
  { ids: ["cash"], label: "cash withdrawals", re: /\b(cash|atm|withdrawals?)\b/ },
  { ids: ["business"], label: "business expenses", re: /\b(business|work expenses)\b/ },
];

export function detectCategory(text: string, custom: { id: string; name: string }[] = []): { ids: string[]; label: string } | null {
  const t = text.toLowerCase();
  for (const c of CATEGORY_WORDS) if (c.re.test(t)) return { ids: c.ids, label: c.label };
  // The user's own categories, matched on their full name.
  for (const c of custom) {
    const name = c.name.toLowerCase().trim();
    if (name.length >= 4 && t.includes(name)) return { ids: [c.id], label: c.name };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

const NOT_MERCHANTS = new Set([
  "the", "my", "all", "a", "an", "least", "most", "home", "this", "last", "next", "work", "total", "once", "first", "average", "any", "each", "every", "it", "them", "that", "these", "those", "me",
  "food", "groceries", "restaurants", "shopping", "entertainment", "transport", "travel", "subscriptions", "bills", "rent", "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "today", "yesterday", "month", "week", "year",
]);

/** Finds a merchant named in the question: first among merchants the user has actually paid, then by "at <Name>" phrasing. */
export function detectMerchant(text: string, known: string[] = []): string | null {
  const t = text.toLowerCase();
  let best: string | null = null;
  for (const name of known) {
    const n = name.toLowerCase().trim();
    if (n.length < 3 || NOT_MERCHANTS.has(n)) continue;
    const at = t.indexOf(n);
    if (at < 0) continue;
    const before = at === 0 ? " " : t[at - 1];
    const after = at + n.length >= t.length ? " " : t[at + n.length];
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
    if (!best || n.length > best.length) best = name;
  }
  if (best) return best;
  const phrased = /\b(?:at|from)\s+([A-Za-z0-9][\w&'.-]{2,}(?:\s+[A-Z][\w&'.-]+){0,2})/.exec(text);
  if (phrased && !NOT_MERCHANTS.has(phrased[1].toLowerCase().split(/\s+/)[0])) return phrased[1].replace(/[?.!,]+$/, "");
  // "on Amazon" - only when capitalised, so "on food" is not a merchant.
  const on = /\b(?:on|to|with)\s+([A-Z][\w&'.-]{2,}(?:\s+[A-Z][\w&'.-]+){0,2})/.exec(text);
  if (on && !NOT_MERCHANTS.has(on[1].toLowerCase().split(/\s+/)[0])) return on[1].replace(/[?.!,]+$/, "");
  return null;
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

const SPEND_VERB = /\b(spend|spent|spending|pay|paid|paying|cost|costs|costing|expenses?|outgoings?|bought|buy)\b/;
const SUB_WORD = /\b(subscriptions?|recurring|memberships?|streaming|standing orders?|direct debits?)\b/;

const EMAIL_KINDS: { category?: string; re: RegExp }[] = [
  { category: "shipping", re: /\b(deliver(y|ies)|packages?|parcels?|shipping|shipments?|tracking|arriving)\b/ },
  { category: "receipt", re: /\b(receipts?)\b/ },
  { category: "bill", re: /\b(invoices?|bills? (in|from) (my )?(e-?mail|inbox))\b/ },
  { category: "order", re: /\b(orders?|ordered)\b/ },
  { category: "booking", re: /\b(bookings?|reservations?|tickets?)\b/ },
  { category: "travel", re: /\b(boarding|itinerar(y|ies))\b/ },
  { re: /\b(e-?mails?|inbox(es)?|mailbox(es)?)\b/ },
];

function limitFrom(t: string): number | undefined {
  const m = /\b(?:top|biggest|largest|last|latest|recent)\s+(\d{1,2})\b/.exec(t) ?? /\b(\d{1,2})\s+(?:biggest|largest|most expensive|latest|recent)\b/.exec(t);
  return m ? Math.min(Math.max(Number(m[1]), 1), 25) : undefined;
}

export interface ParseContext {
  today: Date;
  merchants?: string[];
  categories?: { id: string; name: string }[];
  /** The previous question in the conversation, for follow-ups like "and last month?". */
  previous?: ParsedQuestion | null;
}

export function parseQuestion(question: string, ctx: ParseContext): ParsedQuestion {
  const raw = question.trim();
  const t = raw.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
  const period = parsePeriod(t, ctx.today) ?? undefined;
  const window = parseWindow(t, ctx.today) ?? undefined;
  const cat = detectCategory(t, ctx.categories);
  const merchant = detectMerchant(raw, ctx.merchants) ?? undefined;
  const hasSpendVerb = SPEND_VERB.test(t);
  const perMonth = /\b(every|each|per|a) month\b|\bmonthly\b|\bon average\b|\baverage\b|\busually\b|\btypically\b/.test(t);
  const base = { period, window, perMonth, limit: limitFrom(t) };
  const out = (intent: Intent, extra: Partial<ParsedQuestion> = {}): ParsedQuestion => ({ intent, ...base, ...extra });

  if (/^(help|hi|hello|hey)\b|what can (you|i) (do|ask)|how do(es)? (this|you|it) work|what do you know/.test(t)) return out("help");
  if (/\b(what|which) (data|sources|accounts) (do you|are|is)|\b(is|are) (my )?(e-?mail|gmail|bank|calendar)s? connected|what('s| is) connected/.test(t)) return out("sources");

  if (/(check|what'?s new in|anything (new|important) in|summar(y|ise|ize)|go through|look (at|through)|scan)\b.*\b(e-?mails?|inbox(es)?|mailbox(es)?|mail)\b|\b(new|recent|important|latest|unread) (e-?mails?|mail)\b/.test(t)) {
    return out("email_digest");
  }

  if (/check[- ]?up|check (everything|it all|things|all of it)|full (check|review|report|picture)|\boverview\b|\bbriefing\b|\bsummar(y|ise|ize)\b(?!.*\b(e-?mails?|inbox))|how am i doing|anything (i should know|important|to worry|i need to)|what should i (know|do|look at|worry)|review my (finances|money|spending)|what did i miss|catch me up/.test(t)) {
    return out("checkup");
  }

  // Email-derived facts, unless the question is clearly about money spent.
  const emailKind = EMAIL_KINDS.find((k) => k.re.test(t));
  if (emailKind && (!hasSpendVerb || /\b(e-?mails?|inbox|receipts?)\b/.test(t)) && !/\b(flights?|hotels?|trips?)\b.*\b(cost|spen[dt])\b/.test(t)) {
    return out("emails", { emailCategory: emailKind.category, emailQuery: merchant, merchant });
  }

  if (/\b(events?|appointments?|calendar|agenda|schedule|meetings?|plans|what'?s on|am i (busy|free)|what do i have (on|planned|today|tomorrow|this|next))\b/.test(t) && !hasSpendVerb) return out("events");

  if (/\b(coming up|upcoming|due\b|next (payments?|bills?|charges?)|have to pay|need to pay|will i (pay|be charged)|renew(al|als|ing|s)?\b|about to (be charged|renew))/.test(t)) return out("upcoming_payments");

  if (/\b(forgot|forgotten|unused|(not|never|rarely|barely|hardly) us(e|ed|ing)|don'?t (i )?(use|need)|could (i )?cancel|should i cancel|worth cancell?ing|get rid of|waste|wasting)\b|\bhaven'?t\b.{0,12}\b(used|interacted|opened|touched)\b/.test(t)) {
    return out("subscriptions_forgotten");
  }
  if (/\btrials?\b/.test(t)) return out("trials");
  if (/\bprice (increase|change|hike|rise)s?\b|\b(more expensive|went up|gone up|increased|raised)\b.*\b(price|subscriptions?|bills?)\b|\b(subscriptions?|bills?)\b.*\b(more expensive|went up|gone up|increased)\b/.test(t)) return out("price_changes");
  if (/\b(biggest|largest|top|most expensive|highest)\b.*\b(recurring|subscriptions?|fixed (costs?|expenses?)|bills|memberships?)\b/.test(t)) return out("recurring_biggest");
  if (SUB_WORD.test(t) && (/\bhow much\b|\btotal\b|\bcost(s|ing)?\b|\bper (month|year)\b|\ba (month|year)\b|\bmonthly\b|\byearly\b|\bannual(ly)?\b|\bspen[dt]\b/.test(t))) return out("subscriptions_cost");
  if (SUB_WORD.test(t) || /\bpaying for\b/.test(t)) return out("subscriptions_list");

  if (/\bbudgets?\b/.test(t)) return out("budgets");
  if (/\bbalances?\b|how much (money )?(do i have|have i got|is (in|on) my)|\bnet worth\b|in (my|the) (account|bank)/.test(t)) return out("balance");

  if (/\b(compare|compared|comparison|versus|vs\.?)\b|\b(more|less) than (last|the previous|in)\b|difference between|\bthan (last|the previous) (month|year|week)\b/.test(t)) {
    return out("compare", { categoryIds: cat?.ids, categoryLabel: cat?.label });
  }

  if (/\b(income|earn(ed|ings?)?|salary|wages?|got paid|get paid|paid me|money (came|coming) in|received)\b/.test(t)) return out("income");
  if (/\b(sav(e|ed|ing|ings)|left over|leftover|net (result|income)|cash ?flow|put aside|in (vs\.?|versus|and) out)\b/.test(t)) return out("savings");

  if (/\b(unusual|strange|weird|odd|suspicious|duplicates?|double[- ]charged?|charged twice|twice|unexpected|anomal(y|ies)|out of the ordinary|fraud)\b/.test(t)) return out("unusual");

  if (/\b(biggest|largest|most expensive|highest|big)\b.*\b(purchases?|expenses?|transactions?|payments?|buys?|things)\b|\bwhat was my biggest\b/.test(t)) {
    return out("biggest_purchases", { categoryIds: cat?.ids, categoryLabel: cat?.label });
  }

  if (merchant && (hasSpendVerb || /\bhow (much|many|often)\b/.test(t))) return out("merchant_spend", { merchant });
  if (cat && (hasSpendVerb || /\bhow much\b/.test(t))) return out("category_spend", { categoryIds: cat.ids, categoryLabel: cat.label });

  if (/\b(merchants?|shops?|stores?|retailers?|companies|where do i (shop|spend)|who do i pay|which places)\b/.test(t)) return out("top_merchants");
  if (/\bspen[dt] (the )?most\b|\bmost (of my )?(money )?on\b|where (does|did|is|has) (all )?my money (go|going|went|gone)|\bcategor(y|ies)\b|\bbreak ?down\b|what (do|did) i spend (my money )?on/.test(t)) return out("top_categories");

  if (merchant) return out("merchant_spend", { merchant });
  if (cat) return out("category_spend", { categoryIds: cat.ids, categoryLabel: cat.label });

  if (/\b(transactions?|purchases?|payments?|what did i (buy|pay)|recent(ly)? (bought|paid|spent))\b/.test(t)) return out("recent_transactions");
  if (hasSpendVerb || /\bhow much\b.*\b(money|out)\b/.test(t)) return out("spending_total");

  // Follow-up such as "and last month?" or "what about October?": same question, new period.
  if (ctx.previous && ctx.previous.intent !== "unknown" && ctx.previous.intent !== "help" && (period || window) && raw.length <= 60) {
    return { ...ctx.previous, period: period ?? ctx.previous.period, window: window ?? ctx.previous.window, comparePeriod: undefined };
  }
  return out("unknown");
}

/** Month-to-date vs the same days of the previous month, year-to-date vs last year, or two named periods. */
export function resolveComparison(question: string, today: Date): { a: Period; b: Period } {
  const t = question.toLowerCase();
  const sameSpan = (a: Period, shift: (d: Date) => Date, label: string): Period => {
    const from = shift(parseISODate(a.from));
    const to = shift(parseISODate(a.to));
    return range(from, to, label);
  };
  if (/\b(this|last|previous) year\b|\bytd\b|year to date/.test(t)) {
    const a = range(new Date(today.getFullYear(), 0, 1), today, "this year so far");
    return { a, b: sameSpan(a, (d) => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate()), "the same period last year") };
  }
  if (/\b(this|last|previous) week\b/.test(t)) {
    const a = range(startOfWeek(today), today, "this week so far");
    return { a, b: sameSpan(a, (d) => addDays(d, -7), "the same days last week") };
  }
  // Two named months: "October vs September".
  const named = [...t.matchAll(new RegExp(`\\b${MONTH_RE}\\b(?:\\s+(20\\d{2}))?`, "g"))].filter((m) => m[1] !== "may" || m[2]);
  if (named.length >= 2) {
    const toPeriod = (m: RegExpMatchArray): Period => {
      const idx = monthIndex(m[1])!;
      let year = m[2] ? Number(m[2]) : today.getFullYear();
      if (!m[2] && new Date(year, idx, 1) > today) year -= 1;
      const start = new Date(year, idx, 1);
      return range(start, minDate(endOfMonth(start), today), `${MONTH_NAME(idx)} ${year}`);
    };
    return { a: toPeriod(named[0]), b: toPeriod(named[1]) };
  }
  const a = range(startOfMonth(today), today, "this month so far");
  const prevStart = addMonths(startOfMonth(today), -1);
  const prevEnd = endOfMonth(prevStart);
  const b = range(prevStart, new Date(prevStart.getFullYear(), prevStart.getMonth(), Math.min(today.getDate(), prevEnd.getDate())), "the same days last month");
  return { a, b };
}
