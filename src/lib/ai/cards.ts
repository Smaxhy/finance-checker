/**
 * Visual "data cards" shown under an assistant answer. They are built
 * directly from tool results (never from model-written text), so the figures
 * on a card are exactly what was read from the user's data.
 */
import { formatDate, formatMoney, formatMonth } from "@/lib/format";

export type CardTone = "positive" | "negative" | "warning" | "neutral";

export type DataCard =
  | { kind: "stats"; title: string; items: { label: string; value: string; hint?: string; tone?: CardTone }[]; demo?: boolean }
  | { kind: "bars"; title: string; items: { label: string; value: number; display: string; hint?: string }[]; demo?: boolean }
  | { kind: "table"; title: string; columns: { key: string; label: string; align?: "right" }[]; rows: Record<string, string>[]; more?: number; demo?: boolean };

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const text = (v: unknown, fallback = "—"): string => (typeof v === "string" && v.trim() ? v : fallback);
const day = (v: unknown): string => (typeof v === "string" && v ? formatDate(v.slice(0, 10), "short") : "—");

function periodLabel(p: unknown): string {
  const period = p as { from?: string; to?: string } | null | undefined;
  if (!period?.from || !period.to) return "";
  if (period.from === period.to) return formatDate(period.from, "medium");
  return `${formatDate(period.from, "short")} – ${formatDate(period.to, "medium")}`;
}

function pct(v: unknown): string | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

const MAX_ROWS = 8;
function capped<T>(rows: T[], max = MAX_ROWS): { rows: T[]; more?: number } {
  return rows.length > max ? { rows: rows.slice(0, max), more: rows.length - max } : { rows };
}

/** Cards for one tool result. Returns [] when the result is empty or has nothing worth drawing. */
export function cardsForTool(name: string, result: unknown, currencyFallback = "EUR"): DataCard[] {
  const r = (result ?? {}) as Json;
  if (r.error || r.empty === true) return [];
  const cur = text(r.currency, currencyFallback);
  const money = (v: unknown) => formatMoney(num(v), cur);
  const demo = r.includes_demo_data === true || undefined;

  switch (name) {
    case "spending_summary": {
      const cards: DataCard[] = [
        {
          kind: "stats",
          title: periodLabel(r.period) || "Summary",
          items: [
            { label: "Spent", value: money(r.spent) },
            { label: "Income", value: money(r.income) },
            { label: "Net", value: formatMoney(num(r.net), cur, { sign: true }), tone: num(r.net) >= 0 ? "positive" : "negative" },
            { label: "Per day", value: money(r.average_daily_spending) },
          ],
          demo,
        },
      ];
      const months = arr(r.by_month);
      if (months.length > 1) {
        cards.push({ kind: "bars", title: "Spending by month", items: months.map((m) => ({ label: formatMonth(`${text(m.month)}-01`, "short"), value: num(m.spent), display: money(m.spent) })), demo });
      }
      return cards;
    }
    case "spending_by_category": {
      const cats = arr(r.categories).slice(0, 8);
      return [{ kind: "bars", title: `By category · ${periodLabel(r.period)}`, items: cats.map((c) => ({ label: text(c.category), value: num(c.spent), display: money(c.spent), hint: `${num(c.share_pct)}%` })), demo }];
    }
    case "category_trend": {
      const months = arr(r.months);
      return [{ kind: "bars", title: `${text(r.category)} by month`, items: months.map((m) => ({ label: formatMonth(`${text(m.month)}-01`, "short"), value: num(m.spent), display: money(m.spent), hint: m.complete_month === false ? "so far" : undefined })) }];
    }
    case "spending_by_merchant": {
      if (Array.isArray(r.merchants)) {
        const ms = arr(r.merchants).slice(0, 8);
        return [{ kind: "bars", title: `Top merchants · ${periodLabel(r.period)}`, items: ms.map((m) => ({ label: text(m.merchant), value: num(m.spent), display: money(m.spent), hint: `${num(m.transactions)}×` })) }];
      }
      const recent = arr(r.recent);
      if (!num(r.matched_transactions)) return [];
      const cards: DataCard[] = [
        {
          kind: "stats",
          title: `${text(r.merchant_query)} · ${periodLabel(r.period)}`,
          items: [
            { label: "Spent", value: money(r.spent) },
            { label: "Purchases", value: String(num(r.matched_transactions)) },
            { label: "First", value: day(r.first_purchase) },
            { label: "Last", value: day(r.last_purchase) },
          ],
          demo,
        },
      ];
      if (recent.length) {
        cards.push({
          kind: "table",
          title: "Most recent",
          columns: [
            { key: "date", label: "Date" },
            { key: "merchant", label: "Merchant" },
            { key: "amount", label: "Amount", align: "right" },
          ],
          ...capped(recent.map((t) => ({ date: day(t.date), merchant: text(t.merchant), amount: formatMoney(num(t.amount), cur) }))),
        });
      }
      return cards;
    }
    case "list_transactions": {
      const tx = arr(r.transactions);
      if (!tx.length) return [];
      const c = capped(tx.map((t) => ({ date: day(t.date), merchant: text(t.merchant ?? t.description), amount: formatMoney(num(t.amount), text(t.currency, cur)) })));
      const hidden = Math.max(num(r.total_matching) - c.rows.length, c.more ?? 0);
      return [
        {
          kind: "table",
          title: `Transactions${r.period ? ` · ${periodLabel(r.period)}` : ""}`,
          columns: [
            { key: "date", label: "Date" },
            { key: "merchant", label: "Merchant" },
            { key: "amount", label: "Amount", align: "right" },
          ],
          rows: c.rows,
          more: hidden > 0 ? hidden : undefined,
          demo: tx.some((t) => t.is_demo === true) || undefined,
        },
      ];
    }
    case "compare_periods": {
      const a = (r.period_a ?? {}) as Json;
      const b = (r.period_b ?? {}) as Json;
      const change = num(r.spending_change_pct);
      const cats = arr(r.by_category).filter((c) => num(c.difference) !== 0).slice(0, 6);
      const cards: DataCard[] = [
        {
          kind: "stats",
          title: "Comparison",
          items: [
            { label: periodLabel(a), value: money(a.spent), hint: "spent" },
            { label: periodLabel(b), value: money(b.spent), hint: "spent" },
            { label: "Change", value: pct(r.spending_change_pct) ?? "—", tone: change > 0 ? "negative" : change < 0 ? "positive" : "neutral" },
          ],
        },
      ];
      if (cats.length) {
        cards.push({
          kind: "table",
          title: "Biggest differences",
          columns: [
            { key: "category", label: "Category" },
            { key: "a", label: "Now", align: "right" },
            { key: "b", label: "Before", align: "right" },
            { key: "diff", label: "Difference", align: "right" },
          ],
          rows: cats.map((c) => ({ category: text(c.category), a: money(c.period_a), b: money(c.period_b), diff: formatMoney(num(c.difference), cur, { sign: true }) })),
        });
      }
      return cards;
    }
    case "list_subscriptions": {
      const items = arr(r.items).filter((s) => ["active", "trial", "cancellation_pending"].includes(text(s.status, "")));
      const totals = (r.totals_for_active ?? {}) as Json;
      const shown = items.length ? items : arr(r.items);
      if (!shown.length) return [];
      const c = capped(
        shown.map((s) => ({
          name: text(s.name),
          monthly: formatMoney(num(s.monthly_equivalent), text(s.currency, cur)),
          next: s.status === "trial" ? `trial ends ${day(s.trial_ends_at)}` : s.status === "cancelled" ? "cancelled" : day(s.next_payment_date),
        })),
        10,
      );
      return [
        { kind: "stats", title: "Subscriptions & recurring bills", items: [{ label: "Active", value: String(num(totals.count)) }, { label: "Per month", value: money(totals.monthly) }, { label: "Per year", value: money(totals.yearly) }], demo: shown.some((s) => s.is_demo === true) || undefined },
        {
          kind: "table",
          title: "Most expensive first",
          columns: [
            { key: "name", label: "Name" },
            { key: "monthly", label: "Per month", align: "right" },
            { key: "next", label: "Next payment", align: "right" },
          ],
          ...c,
        },
      ];
    }
    case "upcoming": {
      const items = arr(r.items);
      if (!items.length) return [];
      const c = capped(
        items.map((i) => ({ date: day(i.date), what: text(i.title), type: text(i.type).replace(/_/g, " "), amount: i.amount === null || i.amount === undefined ? "" : formatMoney(num(i.amount), text(i.currency, cur)) })),
        10,
      );
      return [
        {
          kind: "table",
          title: `Coming up · ${periodLabel(r.window)}`,
          columns: [
            { key: "date", label: "Date" },
            { key: "what", label: "What" },
            { key: "type", label: "Type" },
            { key: "amount", label: "Amount", align: "right" },
          ],
          ...c,
          demo: items.some((i) => i.is_demo === true) || undefined,
        },
      ];
    }
    case "search_emails": {
      const emails = arr(r.emails);
      if (!emails.length) return [];
      const multi = Array.isArray(r.connected_mailboxes) && r.connected_mailboxes.length > 1;
      const c = capped(
        emails.map((e) => ({
          date: day(e.received_at),
          from: text(e.merchant ?? e.from_name ?? e.from_email),
          subject: text(e.subject, "").slice(0, 60),
          amount: e.amount === null || e.amount === undefined ? "" : formatMoney(num(e.amount), text(e.currency, cur)),
          mailbox: text(e.mailbox, ""),
        })),
      );
      return [
        {
          kind: "table",
          title: "Matching emails",
          columns: [
            { key: "date", label: "Date" },
            { key: "from", label: "From" },
            { key: "subject", label: "Subject" },
            { key: "amount", label: "Amount", align: "right" },
            ...(multi ? [{ key: "mailbox", label: "Mailbox" }] : []),
          ],
          ...c,
          demo: emails.some((e) => e.is_demo === true) || undefined,
        },
      ];
    }
    case "account_balances": {
      const accounts = arr(r.accounts).filter((a) => a.balance !== null && a.balance !== undefined);
      if (!accounts.length) return [];
      return [{ kind: "bars", title: "Account balances", items: accounts.slice(0, 8).map((a) => ({ label: text(a.name), value: Math.max(num(a.balance), 0), display: formatMoney(num(a.balance), text(a.currency, cur)) })), demo }];
    }
    case "income_summary": {
      const sources = arr(r.sources).slice(0, 8);
      if (!sources.length) return [];
      return [{ kind: "bars", title: `Income by source · ${periodLabel(r.period)}`, items: sources.map((s) => ({ label: text(s.source), value: num(s.total), display: money(s.total), hint: `${num(s.payments)}×` })), demo }];
    }
    case "budget_status": {
      const budgets = arr(r.budgets);
      if (!budgets.length) return [];
      return [
        {
          kind: "table",
          title: "Budgets this month",
          columns: [
            { key: "category", label: "Category" },
            { key: "spent", label: "Spent", align: "right" },
            { key: "limit", label: "Limit", align: "right" },
            { key: "status", label: "Status", align: "right" },
          ],
          ...capped(budgets.map((b) => ({ category: text(b.category), spent: money(b.spent_so_far), limit: money(b.monthly_limit), status: text(b.status) })), 10),
        },
      ];
    }
    case "cash_flow": {
      const months = arr(r.months).filter((m) => num(m.income) > 0 || num(m.spent) > 0);
      if (!months.length) return [];
      return [
        {
          kind: "table",
          title: "Money in and out by month",
          columns: [
            { key: "month", label: "Month" },
            { key: "income", label: "In", align: "right" },
            { key: "spent", label: "Out", align: "right" },
            { key: "net", label: "Net", align: "right" },
          ],
          ...capped(
            months.map((m) => ({ month: `${formatMonth(`${text(m.month)}-01`, "short")}${m.complete_month === false ? " (so far)" : ""}`, income: money(m.income), spent: money(m.spent), net: formatMoney(num(m.net), cur, { sign: true }) })),
            12,
          ),
        },
      ];
    }
    case "email_digest": {
      const cats = (r.by_category ?? {}) as Record<string, number>;
      const boxes = arr(r.by_mailbox);
      const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const cards: DataCard[] = [
        { kind: "stats", title: `Email · ${periodLabel(r.window)}`, items: [{ label: "Relevant emails", value: String(num(r.total_relevant_emails)) }, ...top.map(([k, v]) => ({ label: k.replace(/_/g, " "), value: String(v) }))], demo },
      ];
      if (boxes.length > 1) cards.push({ kind: "bars", title: "By mailbox", items: boxes.map((b) => ({ label: text(b.mailbox), value: num(b.count), display: String(num(b.count)) })) });
      const bills = arr(r.bills_to_pay);
      if (bills.length) {
        cards.push({
          kind: "table",
          title: "Bills found in email",
          columns: [
            { key: "from", label: "From" },
            { key: "amount", label: "Amount", align: "right" },
            { key: "due", label: "Due", align: "right" },
          ],
          ...capped(bills.map((b) => ({ from: text(b.from), amount: b.amount === null || b.amount === undefined ? "" : formatMoney(num(b.amount), text(b.currency, cur)), due: b.due_date ? `${day(b.due_date)}${b.overdue ? " (past)" : ""}` : "—" }))),
        });
      }
      return cards;
    }
    case "unusual_activity": {
      const cards: DataCard[] = [];
      const dup = arr(r.possible_duplicate_charges);
      if (dup.length) {
        cards.push({
          kind: "table",
          title: "Possible duplicate charges",
          columns: [
            { key: "merchant", label: "Merchant" },
            { key: "amount", label: "Amount", align: "right" },
            { key: "dates", label: "Dates", align: "right" },
          ],
          ...capped(dup.map((d) => ({ merchant: text(d.merchant), amount: money(d.amount), dates: (Array.isArray(d.dates) ? (d.dates as string[]) : []).map(day).join(" & ") }))),
        });
      }
      const large = arr(r.large_purchases);
      if (large.length) {
        cards.push({
          kind: "table",
          title: `Large purchases (over ${money(r.large_purchase_threshold)})`,
          columns: [
            { key: "date", label: "Date" },
            { key: "merchant", label: "Merchant" },
            { key: "amount", label: "Amount", align: "right" },
          ],
          ...capped(large.map((t) => ({ date: day(t.date), merchant: text(t.merchant), amount: money(t.amount) }))),
        });
      }
      return cards.map((c) => ({ ...c, demo }));
    }
    case "full_checkup": {
      const m = (r.this_month_so_far ?? {}) as Json;
      const vs = (m.vs_same_days_last_month ?? {}) as Json;
      const subs = (r.subscriptions ?? {}) as Json;
      const next = (r.next_14_days ?? {}) as Json;
      const change = num(vs.spending_change_pct);
      const cards: DataCard[] = [
        {
          kind: "stats",
          title: "At a glance",
          items: [
            { label: "Spent this month", value: money(m.spent), hint: pct(vs.spending_change_pct) ? `${pct(vs.spending_change_pct)} vs last month` : undefined, tone: change > 5 ? "negative" : change < -5 ? "positive" : "neutral" },
            { label: "Income this month", value: money(m.income) },
            { label: "Recurring per month", value: money(subs.monthly), hint: `${num(subs.count)} active` },
            { label: "Due in 14 days", value: money(next.expected_payments_total), hint: `${num(next.expected_payments_count)} payments` },
          ],
          demo,
        },
      ];
      const cats = arr(r.top_categories).slice(0, 6);
      if (cats.length) cards.push({ kind: "bars", title: "Where the money went this month", items: cats.map((c) => ({ label: text(c.category), value: num(c.spent), display: money(c.spent), hint: `${num(c.share_pct)}%` })) });
      return cards;
    }
    default:
      return [];
  }
}
