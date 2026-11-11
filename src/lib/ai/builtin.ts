/**
 * The built-in assistant: answers common questions straight from the user's
 * data with no AI model and no API key. It understands the question with
 * simple language rules (nlu.ts), runs the same data tools Claude would use,
 * and writes the answer from the exact figures those tools return.
 */
import { spendingByMerchant } from "@/lib/data/finance";
import { addDays, parseISODate, toISODate } from "@/lib/dates";
import { dayKey, formatDate, formatMoney } from "@/lib/format";
import { cardsForTool } from "./cards";
import { TOOL_LABELS, type AssistantEvent } from "./events";
import { parseQuestion, resolveComparison, type Intent, type ParsedQuestion, type Period } from "./nlu";
import {
  toolAccounts,
  toolBudgets,
  toolCashFlow,
  toolCategoryTrend,
  toolCheckup,
  toolComparePeriods,
  toolEmailDigest,
  toolIncome,
  toolListSubscriptions,
  toolListTransactions,
  toolSearchEmails,
  toolSources,
  toolSpendingByCategory,
  toolSpendingByMerchant,
  toolSpendingSummary,
  toolUnusual,
  toolUpcoming,
  type ToolContext,
} from "./tools";

export interface BuiltinRunOptions {
  ctx: ToolContext;
  history: { role: "user" | "assistant"; content: string }[];
  emit: (e: AssistantEvent) => void;
  /** Shown when a question is beyond the built-in engine (how to get free-form answers). */
  upgradeHint?: string;
}

const NO_DATA = "I don't have any data for that yet. Bring some in first: import a bank CSV under **Finances → Transactions**, or load sample data under **Settings → Preferences** to try things out.";

const FOLLOW_UPS: Partial<Record<Intent, string[]>> = {
  spending_total: ["What did I spend the most on?", "Compare this month to last month", "What were my biggest purchases?"],
  top_categories: ["How much do I spend on food every month?", "Where do I shop the most?", "Compare this month to last month"],
  category_spend: ["What did I spend the most on?", "What were my biggest purchases this month?", "Am I over budget?"],
  merchant_spend: ["Where do I shop the most?", "What did I spend the most on?"],
  top_merchants: ["What were my biggest purchases?", "What did I spend the most on?"],
  biggest_purchases: ["Anything unusual in my spending?", "What did I spend the most on?"],
  recent_transactions: ["What were my biggest purchases this month?", "How much did I spend this month?"],
  income: ["How much did I save?", "How much did I spend this month?"],
  savings: ["What did I spend the most on?", "What are my biggest recurring expenses?"],
  compare: ["What did I spend the most on?", "Anything unusual in my spending?"],
  subscriptions_list: ["Which subscriptions could I cancel?", "What payments are coming up?", "Any price increases?"],
  subscriptions_cost: ["Which subscriptions could I cancel?", "What are my biggest recurring expenses?"],
  subscriptions_forgotten: ["What subscriptions am I paying for?", "What payments are coming up?"],
  recurring_biggest: ["Which subscriptions could I cancel?", "What payments are coming up?"],
  trials: ["What payments are coming up?", "What subscriptions am I paying for?"],
  price_changes: ["What are my biggest recurring expenses?", "Which subscriptions could I cancel?"],
  upcoming_payments: ["What events do I have next week?", "What subscriptions am I paying for?"],
  events: ["What payments are coming up?", "Check my email"],
  emails: ["Check my email", "What payments are coming up?"],
  email_digest: ["What payments are coming up?", "Any deliveries on the way?", "Run a full check-up"],
  budgets: ["What did I spend the most on?", "Compare this month to last month"],
  balance: ["How much did I spend this month?", "What payments are coming up?"],
  unusual: ["What were my biggest purchases?", "Run a full check-up"],
  checkup: ["Which subscriptions could I cancel?", "Anything unusual in my spending?", "Check my email"],
  sources: ["Run a full check-up", "How much did I spend this month?"],
  help: ["Run a full check-up", "How much did I spend this month?", "What subscriptions am I paying for?", "Check my email"],
  unknown: ["Run a full check-up", "How much did I spend this month?", "What payments are coming up?"],
};

function span(p: { from: string; to: string }): string {
  if (p.from === p.to) return formatDate(p.from, "medium");
  const sameYear = p.from.slice(0, 4) === p.to.slice(0, 4);
  return `${formatDate(p.from, sameYear ? "short" : "medium")} – ${formatDate(p.to, "medium")}`;
}
const describe = (p: Period) => `${p.label} (${span(p)})`;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const signedPct = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`);

/** Whether an item's date (ISO date or datetime) falls inside a window, compared by calendar day. */
function inWindow(date: string, w: { from: string; to: string }): boolean {
  const day = date.length > 10 ? dayKey(date) : date;
  return day >= w.from && day <= w.to;
}

function thisMonth(today: Date): Period {
  return { from: toISODate(new Date(today.getFullYear(), today.getMonth(), 1)), to: toISODate(today), label: "this month" };
}
function lastDays(today: Date, days: number, label: string): Period {
  return { from: toISODate(addDays(today, -(days - 1))), to: toISODate(today), label };
}

/** Names the engine can recognise in a question: merchants paid in the last ~13 months and subscription names. */
async function knownNames(ctx: ToolContext): Promise<{ merchants: string[]; categories: { id: string; name: string }[] }> {
  const from = toISODate(addDays(ctx.today, -400));
  const [merchants, subs, cats] = await Promise.all([
    spendingByMerchant(ctx.supabase, from, toISODate(ctx.today), 300, ctx.userId).catch(() => []),
    ctx.supabase.from("subscriptions").select("name").eq("user_id", ctx.userId).limit(300),
    ctx.supabase.from("categories").select("id, name").limit(200),
  ]);
  const names = new Set<string>(merchants.map((m) => m.merchant).filter(Boolean));
  for (const s of (subs.data ?? []) as { name: string }[]) if (s.name) names.add(s.name);
  return { merchants: [...names], categories: ((cats.data ?? []) as { id: string; name: string }[]) ?? [] };
}

interface Answer {
  text: string;
  /** [toolName, result] pairs to draw cards from, in display order. */
  data?: [string, unknown][];
}

type Composer = (q: ParsedQuestion, ctx: ToolContext, question: string, reading: (tool: string) => void) => Promise<Answer>;

const demoNote = (flag: unknown) => (flag ? "\n\n_These figures include sample (demo) data._" : "");

const COMPOSERS: Record<Exclude<Intent, "unknown" | "help">, Composer> = {
  async spending_total(q, ctx, _question, reading) {
    const p = q.period ?? thisMonth(ctx.today);
    reading("spending_summary");
    reading("spending_by_category");
    const [sum, cats] = await Promise.all([toolSpendingSummary(ctx, p), toolSpendingByCategory(ctx, p)]);
    if (sum.empty) return { text: `I found no transactions for ${describe(p)}. ${NO_DATA}` };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const lines = [`You spent **${m(sum.spent)}** ${describe(p)}.`, ""];
    lines.push(`- Income in the same period: **${m(sum.income)}**, so the net result is **${formatMoney(sum.net, ctx.currency, { sign: true })}**.`);
    lines.push(`- That is about **${m(sum.average_daily_spending)} a day** across ${plural(sum.transactions, "transaction")}.`);
    if (sum.refunds > 0) lines.push(`- Refunds of ${m(sum.refunds)} are already subtracted.`);
    const top = cats.categories.slice(0, 3);
    if (top.length) lines.push(`- Biggest categories: ${top.map((c) => `${c.category} (${m(c.spent)}, ${c.share_pct}%)`).join(", ")}.`);
    const data: [string, unknown][] = [["spending_summary", sum], ["spending_by_category", cats]];
    // A fair comparison for "this month": the same days of last month.
    if (p.label === "this month") {
      const { a, b } = resolveComparison("", ctx.today);
      const cmp = await toolComparePeriods(ctx, { a_from: a.from, a_to: a.to, b_from: b.from, b_to: b.to });
      const change = signedPct(cmp.spending_change_pct);
      if (change && cmp.period_b.spent > 0) lines.push(`- Compared with the same days last month (${m(cmp.period_b.spent)}): **${change}**.`);
    }
    lines.push("", "Transfers between your own accounts are not counted as spending.");
    return { text: lines.join("\n") + demoNote(sum.includes_demo_data), data };
  },

  async top_categories(q, ctx, _question, reading) {
    const p = q.period ?? thisMonth(ctx.today);
    reading("spending_by_category");
    const cats = await toolSpendingByCategory(ctx, p);
    if (cats.empty) return { text: `I found no spending for ${describe(p)}. ${NO_DATA}` };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const [first, ...rest] = cats.categories;
    const lines = [`Your biggest category ${describe(p)} is **${first.category}** at **${m(first.spent)}** (${first.share_pct}% of ${m(cats.total_spent)}).`, ""];
    for (const c of rest.slice(0, 7)) lines.push(`- ${c.category}: ${m(c.spent)} (${c.share_pct}%, ${plural(c.transactions, "transaction")})`);
    if (first.category_id === "housing" && rest[0]) lines.push("", `Leaving out housing, which is mostly fixed, the biggest is **${rest[0].category}** (${m(rest[0].spent)}).`);
    return { text: lines.join("\n"), data: [["spending_by_category", cats]] };
  },

  async category_spend(q, ctx, _question, reading) {
    const ids = q.categoryIds ?? [];
    const label = q.categoryLabel ?? ids.join(" + ");
    const m = (v: number) => formatMoney(v, ctx.currency);
    if (q.period && !q.perMonth) {
      reading("spending_by_category");
      const cats = await toolSpendingByCategory(ctx, q.period);
      const hits = cats.categories.filter((c) => ids.includes(c.category_id));
      const total = hits.reduce((a, c) => a + c.spent, 0);
      if (!hits.length) return { text: `I found no spending on ${label} ${describe(q.period)}.` };
      const lines = [`You spent **${m(total)}** on ${label} ${describe(q.period)}${cats.total_spent ? ` - ${Math.round((total / cats.total_spent) * 1000) / 10}% of everything you spent (${m(cats.total_spent)})` : ""}.`];
      if (hits.length > 1) lines.push("", ...hits.map((c) => `- ${c.category}: ${m(c.spent)} (${plural(c.transactions, "transaction")})`));
      else lines.push("", `- ${plural(hits[0].transactions, "transaction")} in this category.`);
      return { text: lines.join("\n"), data: [["spending_by_category", { ...cats, categories: hits.length > 1 ? hits : cats.categories }]] };
    }
    reading("category_trend");
    const trends = await Promise.all(ids.map((id) => toolCategoryTrend(ctx, { category_id: id, months: 6 })));
    const months = trends[0].months.map((row, i) => ({ ...row, spent: Math.round(trends.reduce((a, t) => a + t.months[i].spent, 0) * 100) / 100 }));
    const complete = months.filter((r) => r.complete_month);
    if (months.every((r) => r.spent === 0)) return { text: `I found no spending on ${label} in the last 6 months. ${NO_DATA}` };
    const avg = complete.length ? complete.reduce((a, r) => a + r.spent, 0) / complete.length : null;
    const current = months[months.length - 1];
    const lines = [avg !== null ? `You spend about **${m(avg)} a month** on ${label} (average of the last ${plural(complete.length, "complete month")}).` : `So far this month you have spent **${m(current.spent)}** on ${label}.`, ""];
    if (avg !== null) lines.push(`- This month so far: **${m(current.spent)}**.`);
    if (complete.length > 1) {
      const hi = complete.reduce((a, r) => (r.spent > a.spent ? r : a));
      const lo = complete.reduce((a, r) => (r.spent < a.spent ? r : a));
      lines.push(`- Highest month: ${formatDate(`${hi.month}-01`, "medium").replace(/^1 /, "")} (${m(hi.spent)}); lowest: ${formatDate(`${lo.month}-01`, "medium").replace(/^1 /, "")} (${m(lo.spent)}).`);
    }
    if (trends.length > 1) for (const t of trends) lines.push(`- ${t.category}: ${t.average_per_complete_month !== null ? `${m(t.average_per_complete_month)} a month on average` : "no complete month yet"}.`);
    return { text: lines.join("\n"), data: [["category_trend", { ...trends[0], category: cap(label), months }]] };
  },

  async merchant_spend(q, ctx, _question, reading) {
    const merchant = q.merchant ?? "";
    const p = q.period ?? lastDays(ctx.today, 365, "the last 12 months");
    reading("spending_by_merchant");
    const r = await toolSpendingByMerchant(ctx, { from: p.from, to: p.to, merchant });
    if (!("matched_transactions" in r) || !r.matched_transactions) return { text: `I found no payments matching "${merchant}" ${describe(p)}. I match on the merchant name and the transaction description.` };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const lines = [`You spent **${m(r.spent)}** at ${merchant} ${describe(p)}, over ${plural(r.matched_transactions, "payment")}.`, ""];
    lines.push(`- Average per payment: ${m(r.spent / r.matched_transactions)}.`);
    if (r.first_purchase && r.last_purchase) lines.push(`- First: ${formatDate(r.first_purchase, "medium")} · most recent: ${formatDate(r.last_purchase, "medium")}.`);
    if (r.merchants_matched.length > 1) lines.push(`- Matched names: ${r.merchants_matched.join(", ")}.`);
    return { text: lines.join("\n") + demoNote(r.includes_demo_data), data: [["spending_by_merchant", r]] };
  },

  async top_merchants(q, ctx, _question, reading) {
    const p = q.period ?? lastDays(ctx.today, 90, "the last 3 months");
    reading("spending_by_merchant");
    const r = await toolSpendingByMerchant(ctx, { from: p.from, to: p.to, limit: q.limit ?? 10 });
    if (!("merchants" in r) || !r.merchants?.length) return { text: `I found no spending ${describe(p)}. ${NO_DATA}` };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const lines = [`The merchant you paid the most ${describe(p)} is **${r.merchants[0].merchant}** (${m(r.merchants[0].spent)}).`, ""];
    for (const x of r.merchants.slice(1, q.limit ?? 8)) lines.push(`- ${x.merchant}: ${m(x.spent)} (${plural(x.transactions, "payment")})`);
    return { text: lines.join("\n"), data: [["spending_by_merchant", r]] };
  },

  async biggest_purchases(q, ctx, _question, reading) {
    const p = q.period ?? thisMonth(ctx.today);
    const n = q.limit ?? 5;
    reading("list_transactions");
    const r = await toolListTransactions(ctx, { from: p.from, to: p.to, kind: "expense", sort: "amount", limit: n, category_id: q.categoryIds?.[0] });
    if (r.empty) return { text: `I found no purchases ${describe(p)}. ${NO_DATA}` };
    const top = r.transactions[0];
    const lines = [`Your biggest ${q.categoryLabel ? `${q.categoryLabel} ` : ""}expense ${describe(p)} was **${formatMoney(Math.abs(top.amount), top.currency)}** at ${top.merchant ?? "an unknown merchant"} on ${formatDate(top.date, "medium")}.`, ""];
    for (const t of r.transactions.slice(1)) lines.push(`- ${formatMoney(Math.abs(t.amount), t.currency)} - ${t.merchant ?? t.description ?? "Unknown"} (${formatDate(t.date, "short")})`);
    return { text: lines.join("\n") + demoNote(r.transactions.some((t) => t.is_demo)), data: [["list_transactions", r]] };
  },

  async recent_transactions(q, ctx, _question, reading) {
    reading("list_transactions");
    const r = await toolListTransactions(ctx, { from: q.period?.from, to: q.period?.to, limit: q.limit ?? 10, merchant: q.merchant });
    if (r.empty) return { text: `I found no transactions${q.period ? ` ${describe(q.period)}` : ""}. ${NO_DATA}` };
    const lines = [`Here are your ${r.returned} most recent transactions${q.period ? ` ${describe(q.period)}` : ""}${r.total_matching > r.returned ? ` (of ${r.total_matching})` : ""}:`, ""];
    for (const t of r.transactions) lines.push(`- ${formatDate(t.date, "short")} · ${t.merchant ?? t.description ?? "Unknown"} · **${formatMoney(t.amount, t.currency, { sign: true })}**`);
    return { text: lines.join("\n"), data: [["list_transactions", r]] };
  },

  async income(q, ctx, _question, reading) {
    let p = q.period ?? thisMonth(ctx.today);
    reading("income_summary");
    let r = await toolIncome(ctx, p);
    let prefix = "";
    if (r.empty && !q.period) {
      // Early in the month the salary may not be in yet: show last month instead.
      const start = new Date(ctx.today.getFullYear(), ctx.today.getMonth() - 1, 1);
      p = { from: toISODate(start), to: toISODate(new Date(start.getFullYear(), start.getMonth() + 1, 0)), label: "last month" };
      r = await toolIncome(ctx, p);
      prefix = "No income has arrived yet this month. ";
    }
    if (r.empty) return { text: `I found no income ${describe(p)}. ${NO_DATA}` };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const lines = [`${prefix}You received **${m(r.total_income)}** ${describe(p)}, in ${plural(r.payments, "payment")}.`, ""];
    for (const s of r.sources.slice(0, 6)) lines.push(`- ${s.source}: ${m(s.total)} (${s.share_pct}%${s.payments > 1 ? `, ${s.payments} payments` : ""})`);
    lines.push("", "Refunds and transfers between your own accounts are not counted as income.");
    return { text: lines.join("\n") + demoNote(r.includes_demo_data), data: [["income_summary", r]] };
  },

  async savings(_q, ctx, _question, reading) {
    reading("cash_flow");
    const r = await toolCashFlow(ctx, { months: 6 });
    if (r.empty) return { text: NO_DATA };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const current = r.months[r.months.length - 1];
    const avg = r.averages_over_complete_months;
    const lines = [`So far this month **${m(current.income)}** came in and **${m(current.spent)}** went out: a net result of **${formatMoney(current.net, ctx.currency, { sign: true })}**.`, ""];
    if (avg.net !== null && avg.income !== null && avg.spent !== null) {
      lines.push(`- Over the last complete months you kept **${formatMoney(avg.net, ctx.currency, { sign: true })} a month** on average (income ${m(avg.income)}, spending ${m(avg.spent)}).`);
      if (avg.income > 0) lines.push(`- That is a savings rate of about **${Math.round((avg.net / avg.income) * 100)}%**.`);
    }
    const complete = r.months.filter((x) => x.complete_month && (x.income > 0 || x.spent > 0));
    if (complete.length > 1) {
      const best = complete.reduce((a, x) => (x.net > a.net ? x : a));
      const worst = complete.reduce((a, x) => (x.net < a.net ? x : a));
      lines.push(`- Best month: ${best.month} (${formatMoney(best.net, ctx.currency, { sign: true })}); weakest: ${worst.month} (${formatMoney(worst.net, ctx.currency, { sign: true })}).`);
    }
    lines.push("", "This is income minus spending. Money you moved to a savings account is a transfer and shows up as neither.");
    return { text: lines.join("\n"), data: [["cash_flow", r]] };
  },

  async compare(q, ctx, question, reading) {
    const { a, b } = resolveComparison(question, ctx.today);
    reading("compare_periods");
    const r = await toolComparePeriods(ctx, { a_from: a.from, a_to: a.to, b_from: b.from, b_to: b.to });
    if (!r.period_a.transactions && !r.period_b.transactions) return { text: NO_DATA };
    const m = (v: number) => formatMoney(v, ctx.currency);
    if (q.categoryIds?.length && q.categoryLabel) {
      // Compare one category only.
      const [ca, cb] = await Promise.all([toolSpendingByCategory(ctx, a), toolSpendingByCategory(ctx, b)]);
      const sum = (rows: typeof ca.categories) => rows.filter((c) => q.categoryIds!.includes(c.category_id)).reduce((x, c) => x + c.spent, 0);
      const [va, vb] = [sum(ca.categories), sum(cb.categories)];
      const diff = va - vb;
      return {
        text: `On ${q.categoryLabel} you spent **${m(va)}** ${describe(a)} against **${m(vb)}** ${describe(b)}: ${diff === 0 ? "exactly the same" : `**${m(Math.abs(diff))} ${diff > 0 ? "more" : "less"}**${vb ? ` (${signedPct(Math.round((diff / vb) * 1000) / 10)})` : ""}`}.`,
        data: [["compare_periods", r]],
      };
    }
    const diff = r.period_a.spent - r.period_b.spent;
    const change = signedPct(r.spending_change_pct);
    const lines = [
      `You spent **${m(r.period_a.spent)}** ${describe(a)}, against **${m(r.period_b.spent)}** ${describe(b)}: ${diff === 0 ? "exactly the same" : `**${m(Math.abs(diff))} ${diff > 0 ? "more" : "less"}**${change ? ` (${change})` : ""}`}.`,
      "",
    ];
    const moved = r.by_category.filter((c) => Math.abs(c.difference) >= 1).slice(0, 5);
    if (moved.length) {
      lines.push("What changed the most:");
      for (const c of moved) lines.push(`- ${c.category}: ${m(c.period_a)} vs ${m(c.period_b)} (${formatMoney(c.difference, ctx.currency, { sign: true })})`);
    }
    if (r.period_a.income || r.period_b.income) lines.push("", `Income: ${m(r.period_a.income)} vs ${m(r.period_b.income)}.`);
    if (r.note) lines.push("", "Note: the two periods are not the same length.");
    return { text: lines.join("\n"), data: [["compare_periods", r]] };
  },

  async subscriptions_list(_q, ctx, _question, reading) {
    reading("list_subscriptions");
    const r = await toolListSubscriptions(ctx, { status: "all" });
    const live = r.items.filter((s) => ["active", "trial", "cancellation_pending"].includes(s.status));
    if (!live.length) return { text: "I haven't found any active subscriptions or recurring bills yet. They are detected from repeating bank charges and from subscription emails, so they appear once there are a few months of transactions or a connected mailbox." };
    const m = (v: number, c = ctx.currency) => formatMoney(v, c);
    const subs = live.filter((s) => s.type === "subscription");
    const bills = live.filter((s) => s.type !== "subscription");
    const row = (s: (typeof live)[number]) =>
      `- **${s.name}**: ${s.amount === null ? "amount unknown" : `${m(s.amount, s.currency)} ${s.billing_cycle === "unknown" ? "" : s.billing_cycle}`.trim()}${s.status === "trial" ? ` · trial ends ${formatDate(s.trial_ends_at, "short")}` : s.next_payment_date ? ` · next ${formatDate(s.next_payment_date, "short")}` : ""}${s.status === "cancellation_pending" ? " · cancellation requested" : ""}`;
    const lines = [`You are paying for **${plural(live.length, "recurring service")}**: **${m(r.totals_for_active.monthly)} a month**, or ${m(r.totals_for_active.yearly)} a year.`];
    if (subs.length) lines.push("", `**Subscriptions (${subs.length})**`, ...subs.slice(0, 15).map(row));
    if (bills.length) lines.push("", `**Bills and fixed costs (${bills.length})**`, ...bills.slice(0, 12).map(row));
    const cancelled = r.items.filter((s) => s.status === "cancelled").length;
    if (cancelled) lines.push("", `${plural(cancelled, "cancelled subscription")} not shown.`);
    return { text: lines.join("\n") + demoNote(live.some((s) => s.is_demo)), data: [["list_subscriptions", r]] };
  },

  async subscriptions_cost(q, ctx, _question, reading) {
    reading("list_subscriptions");
    const r = await toolListSubscriptions(ctx, { status: "all" });
    const live = r.items.filter((s) => ["active", "trial", "cancellation_pending"].includes(s.status));
    if (!live.length) return { text: "I haven't found any active subscriptions or recurring bills yet." };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const total = (rows: typeof live) => rows.reduce((a, s) => a + s.monthly_equivalent, 0);
    const subs = live.filter((s) => s.type === "subscription");
    const bills = live.filter((s) => s.type !== "subscription");
    const lines = [`Your ${plural(subs.length, "subscription")} cost **${m(total(subs))} a month** (${m(total(subs) * 12)} a year).`, ""];
    if (bills.length) lines.push(`- Bills and fixed costs (rent, utilities, insurance): ${m(total(bills))} a month.`, `- Everything recurring together: **${m(r.totals_for_active.monthly)} a month**, ${m(r.totals_for_active.yearly)} a year.`);
    const data: [string, unknown][] = [["list_subscriptions", r]];
    if (q.period) {
      reading("spending_by_category");
      const cats = await toolSpendingByCategory(ctx, q.period);
      const paid = cats.categories.find((c) => c.category_id === "subscriptions");
      lines.push(`- Actually charged for subscriptions ${describe(q.period)}: **${m(paid?.spent ?? 0)}**${paid ? ` in ${plural(paid.transactions, "payment")}` : ""}.`);
    }
    const top = [...subs].sort((a, b) => b.monthly_equivalent - a.monthly_equivalent).slice(0, 3);
    if (top.length) lines.push(`- Most expensive: ${top.map((s) => `${s.name} (${m(s.monthly_equivalent)}/month)`).join(", ")}.`);
    return { text: lines.join("\n") + demoNote(live.some((s) => s.is_demo)), data };
  },

  async subscriptions_forgotten(_q, ctx, _question, reading) {
    reading("list_subscriptions");
    const r = await toolListSubscriptions(ctx, { status: "all" });
    const live = r.items.filter((s) => (s.status === "active" || s.status === "trial") && s.type === "subscription");
    if (!live.length) return { text: "I haven't found any active subscriptions yet." };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const quiet = live.filter((s) => s.possibly_forgotten);
    const lines: string[] = [];
    if (quiet.length) {
      const sum = quiet.reduce((a, s) => a + s.monthly_equivalent, 0);
      lines.push(`**${plural(quiet.length, "subscription")}** had no sign of life in the last 90 days, together **${m(sum)} a month** (${m(sum * 12)} a year):`, "");
      for (const s of quiet) lines.push(`- **${s.name}**: ${m(s.monthly_equivalent)} a month${s.last_payment_date ? ` · last charged ${formatDate(s.last_payment_date, "short")}` : ""}`);
    } else {
      lines.push(`None of your ${plural(live.length, "subscription")} stands out as forgotten.`);
    }
    lines.push(
      "",
      "I can't see whether you actually use a service. \"No sign of life\" means no email from the provider and no review by you in 90 days.",
      "",
      "To cancel one, open it under **Subscriptions** and follow the cancellation steps. Nothing is cancelled until you confirm it yourself.",
    );
    return { text: lines.join("\n"), data: [["list_subscriptions", r]] };
  },

  async recurring_biggest(q, ctx, _question, reading) {
    reading("list_subscriptions");
    const r = await toolListSubscriptions(ctx, { status: "all" });
    const live = r.items.filter((s) => ["active", "trial", "cancellation_pending"].includes(s.status));
    if (!live.length) return { text: "I haven't found any recurring expenses yet." };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const top = live.slice(0, q.limit ?? 6);
    const lines = [`Your biggest recurring expense is **${top[0].name}** at **${m(top[0].monthly_equivalent)} a month**.`, ""];
    for (const s of top.slice(1)) lines.push(`- ${s.name}: ${m(s.monthly_equivalent)} a month (${s.type})`);
    const share = r.totals_for_active.monthly ? Math.round((top.reduce((a, s) => a + s.monthly_equivalent, 0) / r.totals_for_active.monthly) * 100) : 0;
    lines.push("", `These ${top.length} make up ${share}% of the **${m(r.totals_for_active.monthly)}** you pay every month in recurring costs.`);
    return { text: lines.join("\n"), data: [["list_subscriptions", r]] };
  },

  async trials(_q, ctx, _question, reading) {
    reading("list_subscriptions");
    const r = await toolListSubscriptions(ctx, { status: "trial" });
    if (!r.items.length) return { text: "You have no free trials running that I know of. Trials are picked up from sign-up emails, so they appear when a mailbox is connected." };
    const lines = [`You have **${plural(r.items.length, "trial")}** running:`, ""];
    for (const s of r.items) lines.push(`- **${s.name}**: ends ${formatDate(s.trial_ends_at, "medium")}${s.amount !== null ? `, then ${formatMoney(s.amount, s.currency)} ${s.billing_cycle}` : ""}`);
    lines.push("", "Cancel before the end date if you don't want to be charged. Nothing is cancelled until you do it and confirm it.");
    return { text: lines.join("\n"), data: [["list_subscriptions", r]] };
  },

  async price_changes(_q, ctx) {
    const since = toISODate(addDays(ctx.today, -180));
    const { data } = await ctx.supabase.from("subscriptions").select("name, amount, previous_amount, price_changed_at, currency, billing_cycle, status").eq("user_id", ctx.userId).not("price_changed_at", "is", null).gte("price_changed_at", since).order("price_changed_at", { ascending: false });
    const rows = ((data ?? []) as { name: string; amount: number | null; previous_amount: number | null; price_changed_at: string; currency: string; billing_cycle: string; status: string }[]).filter((s) => s.amount !== null && s.previous_amount !== null && s.status !== "cancelled");
    if (!rows.length) return { text: "I found no price changes on your subscriptions or bills in the last 6 months." };
    const ups = rows.filter((s) => Number(s.amount) > Number(s.previous_amount));
    const lines = [`${plural(rows.length, "recurring charge")} changed price in the last 6 months${ups.length ? `, ${ups.length} of them upwards` : ""}:`, ""];
    for (const s of rows) {
      const diff = Number(s.amount) - Number(s.previous_amount);
      lines.push(`- **${s.name}**: ${formatMoney(Number(s.previous_amount), s.currency)} → ${formatMoney(Number(s.amount), s.currency)} (${formatMoney(diff, s.currency, { sign: true })}) since ${formatDate(s.price_changed_at, "medium")}`);
    }
    return { text: lines.join("\n") };
  },

  async upcoming_payments(q, ctx, _question, reading) {
    const w = q.window ?? { from: toISODate(ctx.today), to: toISODate(addDays(ctx.today, 14)), label: "the next 2 weeks" };
    const days = Math.max(1, Math.round((parseISODate(w.to).getTime() - parseISODate(w.from).getTime()) / 86_400_000) + 1);
    reading("upcoming");
    const r = await toolUpcoming(ctx, { days, from: w.from });
    const payments = r.items.filter((i) => ["subscription", "bill", "payment_due", "trial_end", "cancellation_deadline"].includes(i.type) && inWindow(i.date, w));
    if (!payments.length) return { text: `I see no payments due ${describe(w)}.` };
    const withAmount = payments.filter((i) => i.amount !== null);
    const total = withAmount.reduce((a, i) => a + (i.amount ?? 0), 0);
    const lines = [`**${plural(withAmount.length, "payment")}** expected ${describe(w)}, **${formatMoney(total, ctx.currency)}** in total.`, ""];
    for (const i of payments.slice(0, 15)) lines.push(`- ${formatDate(i.date.slice(0, 10), "short")} · **${i.title}**${i.amount !== null ? ` · ${formatMoney(i.amount, i.currency ?? ctx.currency)}` : ""}${i.type === "trial_end" ? " (trial ends)" : i.type === "cancellation_deadline" ? " (last day to cancel)" : ""}`);
    if (payments.length > 15) lines.push(`- ...and ${payments.length - 15} more.`);
    lines.push("", "Dates for subscriptions are predicted from earlier charges, so they can be a day or two off.");
    return { text: lines.join("\n") + demoNote(payments.some((i) => i.is_demo)), data: [["upcoming", { ...r, window: { from: w.from, to: w.to }, items: payments }]] };
  },

  async events(q, ctx, _question, reading) {
    const w = q.window ?? { from: toISODate(ctx.today), to: toISODate(addDays(ctx.today, 7)), label: "the next 7 days" };
    const days = Math.max(1, Math.round((parseISODate(w.to).getTime() - parseISODate(w.from).getTime()) / 86_400_000) + 1);
    reading("upcoming");
    const r = await toolUpcoming(ctx, { days, from: w.from });
    // Overdue tasks are listed by the data layer too; a question about a future window shouldn't show them.
    const events = r.items.filter((i) => !["subscription", "bill", "payment_due", "trial_end", "cancellation_deadline"].includes(i.type) && inWindow(i.date, w));
    if (!events.length) return { text: `Nothing is planned ${describe(w)}. Events come from your calendar, from bookings found in email and from tasks you add yourself.` };
    const lines = [`You have **${plural(events.length, "thing")}** planned ${describe(w)}:`, ""];
    for (const i of events.slice(0, 20)) {
      const time = i.all_day ? "" : ` ${new Intl.DateTimeFormat("en-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }).format(new Date(i.date))}`;
      lines.push(`- ${formatDate(i.all_day ? i.date.slice(0, 10) : i.date, "short")}${time} · **${i.title}**${i.detail ? ` · ${i.detail}` : ""}${i.type !== "event" && i.type !== "other" ? ` (${i.type})` : ""}`);
    }
    return { text: lines.join("\n") + demoNote(events.some((i) => i.is_demo)), data: [["upcoming", { ...r, window: { from: w.from, to: w.to }, items: events }]] };
  },

  async emails(q, ctx, _question, reading) {
    const p = q.period;
    reading("search_emails");
    const r = await toolSearchEmails(ctx, { category: q.emailCategory, query: q.emailQuery, from: p?.from, to: p?.to, limit: 25 });
    const what = `${q.emailCategory ? { shipping: "delivery emails", receipt: "receipts", bill: "bills", order: "order confirmations", booking: "bookings", travel: "travel emails" }[q.emailCategory] ?? "emails" : "emails"}${q.emailQuery ? ` from ${q.emailQuery}` : ""}`;
    if (r.empty) {
      const none = !r.connected_mailboxes?.length;
      return { text: `I found no ${what}${p ? ` ${describe(p)}` : ""}.${none ? " No mailbox is connected yet - add one under **Settings → Connected Accounts** and I can look through your receipts, bills, orders and bookings." : ""}` };
    }
    const totals = Object.entries(r.amount_totals_by_currency ?? {});
    const lines = [`I found **${plural(r.count, what.replace(/s$/, ""), what)}**${p ? ` ${describe(p)}` : ""}${totals.length ? `, adding up to ${totals.map(([c, v]) => formatMoney(v, c)).join(" + ")}` : ""}.`, ""];
    for (const e of r.emails.slice(0, 10)) {
      const row = e as unknown as { received_at: string; merchant: string | null; from_name: string | null; subject: string | null; amount: number | null; currency: string | null; due_date: string | null; mailbox: string | null };
      lines.push(`- ${formatDate(row.received_at, "short")} · **${row.merchant ?? row.from_name ?? "Unknown"}**${row.amount !== null ? ` · ${formatMoney(Number(row.amount), row.currency ?? ctx.currency)}` : ""}${row.subject ? ` · ${row.subject.slice(0, 70)}` : ""}${row.due_date ? ` · due ${formatDate(row.due_date, "short")}` : ""}`);
    }
    if (r.count > 10) lines.push(`- ...and ${r.count - 10} more under **Emails**.`);
    return { text: lines.join("\n") + demoNote(r.emails.some((e) => (e as { is_demo?: boolean }).is_demo)), data: [["search_emails", r]] };
  },

  async email_digest(q, ctx, _question, reading) {
    const days = q.period ? Math.max(1, Math.round((ctx.today.getTime() - parseISODate(q.period.from).getTime()) / 86_400_000) + 1) : 7;
    reading("email_digest");
    const r = await toolEmailDigest(ctx, { days });
    if (r.empty) {
      return {
        text: r.connected_mailboxes.length
          ? `Nothing important arrived in the last ${plural(days, "day")} in ${r.connected_mailboxes.join(", ")}. I only keep receipts, bills, orders, bookings and other important mail - newsletters and personal messages are skipped.`
          : "No mailbox is connected yet, so there is nothing to check. Add your email accounts under **Settings → Connected Accounts** (read-only) and I'll go through receipts, bills, orders, deliveries and bookings for you.",
      };
    }
    const money = (a: number | null, c: string | null) => (a === null ? "" : ` · ${formatMoney(a, c ?? ctx.currency)}`);
    const lines = [`In the last ${plural(days, "day")} I found **${plural(r.total_relevant_emails, "email")} worth knowing about**${r.by_mailbox.length > 1 ? ` across ${r.by_mailbox.map((b) => `${b.mailbox} (${b.count})`).join(", ")}` : r.connected_mailboxes.length === 1 ? ` in ${r.connected_mailboxes[0]}` : ""}.`];
    const section = (title: string, rows: string[]) => {
      if (rows.length) lines.push("", `**${title}**`, ...rows);
    };
    section("Bills to pay", r.bills_to_pay.map((b) => `- ${b.from ?? "Unknown"}${money(b.amount, b.currency)}${b.due_date ? ` · due ${formatDate(b.due_date, "short")}${b.overdue ? " - **that date has passed**" : ""}` : ""}`));
    section("Trials and renewals", r.trials_and_renewals.map((t) => `- ${t.from ?? "Unknown"}${money(t.amount, t.currency)}${t.trial_end_date ? ` · trial ends ${formatDate(t.trial_end_date, "short")}` : t.renewal_date ? ` · renews ${formatDate(t.renewal_date, "short")}` : ""}`));
    section("Deliveries", r.deliveries.map((d) => `- ${d.from ?? "Package"}${d.delivery_date ? ` · expected ${formatDate(d.delivery_date, "short")}` : ""}${d.carrier ? ` · ${d.carrier}` : ""}`));
    section("Bookings and appointments", r.bookings_and_appointments.map((b) => `- ${b.from ?? cap(b.kind)}${b.starts ? ` · ${formatDate(b.starts, "medium")}` : ""}${b.location ? ` · ${b.location}` : ""}`));
    section("Receipts and orders", r.receipts_and_orders.slice(0, 8).map((e) => `- ${formatDate(e.date, "short")} · ${e.from ?? "Unknown"}${money(e.amount, e.currency)}`));
    section("Cancellations confirmed by email", r.cancellations.map((e) => `- ${e.from ?? "Unknown"} · ${formatDate(e.date, "short")}`));
    section("Also marked important", r.other_important.slice(0, 6).map((e) => `- ${e.from ?? "Unknown"}${e.subject ? ` · ${e.subject}` : ""}`));
    lines.push("", "I can't tell from an email whether a bill has already been paid. Newsletters, promotions and personal mail are never stored.");
    return { text: lines.join("\n") + demoNote(r.includes_demo_data), data: [["email_digest", r]] };
  },

  async budgets(_q, ctx, _question, reading) {
    reading("budget_status");
    const r = await toolBudgets(ctx);
    if (r.empty) return { text: "You haven't set any budgets yet. Add monthly limits per category under **Finances → Budgets** and I'll keep an eye on them." };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const over = r.budgets.filter((b) => b.status === "over budget");
    const risk = r.budgets.filter((b) => b.status === "on track to exceed");
    const lines = [over.length ? `You are **over budget in ${plural(over.length, "category", "categories")}**${risk.length ? ` and heading over in ${risk.length} more` : ""} (day ${r.day_of_month} of ${r.days_in_month}).` : risk.length ? `You are within every budget so far, but **${plural(risk.length, "category", "categories")}** will go over at this pace (day ${r.day_of_month} of ${r.days_in_month}).` : `You are on track in all ${plural(r.budgets.length, "budget")} (day ${r.day_of_month} of ${r.days_in_month}).`, ""];
    for (const b of r.budgets) lines.push(`- **${b.category}**: ${m(b.spent_so_far)} of ${m(b.monthly_limit)} (${b.used_pct ?? 0}%) - ${b.status}${b.status !== "on track" ? `, heading for about ${m(b.projected_month_end)}` : `, ${m(Math.max(b.remaining, 0))} left`}`);
    lines.push("", "\"Heading for\" assumes you keep spending at the same pace for the rest of the month.");
    return { text: lines.join("\n"), data: [["budget_status", r]] };
  },

  async balance(_q, ctx, _question, reading) {
    reading("account_balances");
    const r = await toolAccounts(ctx);
    const known = r.accounts.filter((a) => a.balance !== null);
    if (!known.length) return { text: r.empty ? NO_DATA : "I don't know your balances. A CSV import only carries a balance when the bank's file includes one; a live bank connection (full edition) reports it automatically." };
    const totals = Object.entries(r.total_by_currency);
    const lines = [`Across ${plural(known.length, "account")} you have **${totals.map(([c, v]) => formatMoney(v, c)).join(" + ")}**.`, ""];
    for (const a of known) lines.push(`- ${a.name}: ${formatMoney(a.balance, a.currency)}${a.balance_updated_at ? ` (as of ${formatDate(a.balance_updated_at, "short")})` : ""}${a.counted_in_total ? "" : " - not counted in the total"}`);
    return { text: lines.join("\n") + demoNote(r.includes_demo_data), data: [["account_balances", r]] };
  },

  async unusual(_q, ctx, _question, reading) {
    reading("unusual_activity");
    const r = await toolUnusual(ctx, { days: 45 });
    const m = (v: number) => formatMoney(v, ctx.currency);
    if (r.empty) return { text: `Nothing stands out in the last ${r.period.days} days: no possible duplicate charges, no purchases over ${m(r.large_purchase_threshold)} and no sizeable payments to new merchants.` };
    const lines = [`Here is what stands out in the last ${r.period.days} days:`];
    if (r.possible_duplicate_charges.length) {
      lines.push("", "**Possible duplicate charges**");
      for (const d of r.possible_duplicate_charges) lines.push(`- ${d.merchant}: ${m(d.amount)} twice (${d.dates.map((x) => formatDate(x, "short")).join(" and ")})`);
    }
    if (r.large_purchases.length) {
      lines.push("", `**Large purchases (over ${m(r.large_purchase_threshold)})**`);
      for (const t of r.large_purchases.slice(0, 6)) lines.push(`- ${formatDate(t.date, "short")} · ${t.merchant} · ${m(t.amount)}`);
    }
    if (r.new_merchants.length) {
      lines.push("", "**Merchants you hadn't paid before**");
      for (const n of r.new_merchants.slice(0, 6)) lines.push(`- ${n.merchant}: ${m(n.spent)} since ${formatDate(n.first_seen, "short")}`);
    }
    lines.push("", "A possible duplicate is two identical charges at the same merchant within two days. It can be legitimate - check your bank statement before disputing anything.");
    return { text: lines.join("\n") + demoNote(r.includes_demo_data), data: [["unusual_activity", r]] };
  },

  async checkup(_q, ctx, _question, reading) {
    reading("full_checkup");
    const r = await toolCheckup(ctx);
    if (r.empty) return { text: NO_DATA };
    const m = (v: number) => formatMoney(v, ctx.currency);
    const month = r.this_month_so_far;
    const vs = month.vs_same_days_last_month;
    const change = signedPct(vs.spending_change_pct);
    const lines = [`Here is your check-up for ${formatDate(r.date, "long")}.`];

    lines.push("", "**Money this month**");
    lines.push(`- Spent **${m(month.spent)}** so far${change && vs.spent > 0 ? `, **${change}** against the same days last month (${m(vs.spent)})` : ""}.`);
    lines.push(`- Income ${m(month.income)}, net ${formatMoney(month.net, ctx.currency, { sign: true })}.`);
    if (r.top_categories.length) lines.push(`- Most went to ${r.top_categories.slice(0, 3).map((c) => `${c.category} (${m(c.spent)})`).join(", ")}.`);
    const jump = r.biggest_category_changes.find((c) => c.difference > 20 && (c.change_pct ?? 0) > 15);
    if (jump) lines.push(`- **${jump.category}** is up ${m(jump.difference)} on last month (${m(jump.period_a)} vs ${m(jump.period_b)}).`);

    const s = r.subscriptions;
    lines.push("", "**Subscriptions and fixed costs**");
    lines.push(`- ${plural(s.count, "recurring payment")}: **${m(s.monthly)} a month** (${m(s.yearly)} a year).`);
    if (s.trials.length) lines.push(`- Trials running: ${s.trials.map((t) => `${t.name} (ends ${formatDate(t.trial_ends_at, "short")})`).join(", ")}.`);
    if (s.possibly_forgotten.length) lines.push(`- Possibly forgotten: ${s.possibly_forgotten.map((f) => `${f.name} (${m(f.monthly_equivalent)}/month)`).join(", ")} - no sign of life in 90 days.`);
    if (s.cancellation_pending.length) lines.push(`- Waiting for cancellation confirmation: ${s.cancellation_pending.map((c) => c.name).join(", ")}.`);

    const next = r.next_14_days;
    lines.push("", "**Next 14 days**");
    lines.push(next.expected_payments_count ? `- ${plural(next.expected_payments_count, "payment")} expected, **${m(next.expected_payments_total)}** in total.` : "- No payments expected.");
    for (const i of next.items.filter((x) => x.amount !== null).slice(0, 5)) lines.push(`- ${formatDate(i.date.slice(0, 10), "short")} · ${i.title} · ${formatMoney(i.amount, i.currency ?? ctx.currency)}`);
    const todayIso = toISODate(ctx.today);
    const isPlan = (x: { type: string }) => !["subscription", "bill", "payment_due", "trial_end", "cancellation_deadline"].includes(x.type);
    const overdue = next.items.filter((x) => x.type === "task" && (x.date.length > 10 ? dayKey(x.date) : x.date) < todayIso);
    const plans = next.items.filter((x) => isPlan(x) && !overdue.includes(x));
    if (plans.length) lines.push(`- Planned: ${plans.slice(0, 4).map((p) => `${p.title} (${formatDate(p.date.slice(0, 10), "short")})`).join(", ")}${plans.length > 4 ? ` and ${plans.length - 4} more` : ""}.`);
    if (overdue.length) lines.push(`- **Overdue tasks:** ${overdue.slice(0, 4).map((t) => t.title).join(", ")}.`);

    const u = r.unusual;
    if (u.possible_duplicate_charges.length || u.large_purchases.length || u.new_merchants.length) {
      lines.push("", "**Worth a second look**");
      for (const d of u.possible_duplicate_charges.slice(0, 3)) lines.push(`- Possible duplicate: ${d.merchant}, ${m(d.amount)} twice (${d.dates.map((x) => formatDate(x, "short")).join(" and ")}).`);
      for (const t of u.large_purchases.slice(0, 3)) lines.push(`- Large purchase: ${t.merchant}, ${m(t.amount)} on ${formatDate(t.date, "short")}.`);
      for (const n of u.new_merchants.slice(0, 2)) lines.push(`- New merchant: ${n.merchant}, ${m(n.spent)}.`);
    }

    if (r.budgets.length) {
      lines.push("", "**Budgets**");
      for (const b of r.budgets) lines.push(`- ${b.category}: ${m(b.spent_so_far)} of ${m(b.monthly_limit)} - ${b.status}.`);
    } else if (r.budgets_set > 0) {
      lines.push("", "**Budgets**", `- All ${plural(r.budgets_set, "budget")} on track.`);
    }

    const mail = r.email_last_14_days;
    if (mail) {
      lines.push("", "**Email (last 14 days)**");
      lines.push(`- ${plural(mail.total, "relevant email")}${mail.connected_mailboxes.length ? ` in ${mail.connected_mailboxes.join(", ")}` : ""}.`);
      for (const b of mail.bills_to_pay.slice(0, 4)) lines.push(`- Bill: ${b.from ?? "Unknown"}${b.amount !== null ? ` · ${formatMoney(b.amount, b.currency ?? ctx.currency)}` : ""}${b.due_date ? ` · due ${formatDate(b.due_date, "short")}${b.overdue ? " (date passed)" : ""}` : ""}.`);
      for (const d of mail.deliveries.slice(0, 3)) lines.push(`- Delivery: ${d.from ?? "Package"}${d.delivery_date ? ` · expected ${formatDate(d.delivery_date, "short")}` : ""}.`);
      for (const b of mail.bookings_and_appointments.slice(0, 3)) lines.push(`- ${cap(b.kind)}: ${b.from ?? ""}${b.starts ? ` · ${formatDate(b.starts, "medium")}` : ""}.`);
    } else if (!r.sources.connections.some((c) => c.type === "Google account")) {
      lines.push("", "**Email**", "- No mailbox connected, so bills, deliveries and bookings in your email are not checked. Add one under **Settings → Connected Accounts**.");
    }

    if (r.unread_alerts.length) lines.push("", `**${plural(r.unread_alerts.length, "unread alert")}**`, ...r.unread_alerts.slice(0, 5).map((a) => `- ${a.title}`));
    return { text: lines.join("\n") + demoNote(r.includes_demo_data), data: [["full_checkup", r]] };
  },

  async sources(_q, ctx, _question, reading) {
    reading("data_sources");
    const r = await toolSources(ctx);
    if (r.empty) return { text: NO_DATA };
    const lines = ["Here is what I can see:", ""];
    for (const c of r.connections) lines.push(`- **${c.label}** (${c.type}): ${c.status === "active" ? "connected" : c.status}${c.last_checked ? `, last checked ${formatDate(c.last_checked, "medium")}` : ", not checked yet"}${c.problem ? ` - ${c.problem}` : ""}`);
    lines.push(`- ${plural(r.stored.transactions, "transaction")}${r.transactions_cover.from ? ` from ${formatDate(r.transactions_cover.from, "medium")} to ${formatDate(r.transactions_cover.to, "medium")}` : ""}${r.stored.demo_transactions ? ` (${r.stored.demo_transactions} are sample data)` : ""}`);
    lines.push(`- ${plural(r.stored.subscriptions, "subscription")} and recurring bills, ${plural(r.stored.emails, "email")}, ${plural(r.stored.calendar_events, "calendar event")}`);
    return { text: lines.join("\n") };
  },
};

const HELP = `I answer questions about your own money, subscriptions, email and plans. Everything is calculated from your data on the spot, nothing is guessed.

**Things you can ask**
- "How much did I spend this month?" · "...on food every month?" · "...at Amazon this year?"
- "What did I spend the most on?" · "Compare this month to last month"
- "What subscriptions am I paying for?" · "Which could I cancel?" · "Any price increases?"
- "What payments are coming up?" · "What events do I have next week?"
- "How much did I earn last month?" · "How much did I save?" · "Am I over budget?"
- "Anything unusual in my spending?" · "Check my email" · "Any deliveries on the way?"
- "Run a full check-up" for everything at once

You can name a period ("last month", "in October", "the last 90 days", "2025") and follow up with "and last month?".`;

function chunks(text: string): string[] {
  // Stream paragraph by paragraph so long answers appear progressively.
  const parts = text.split(/(\n\n)/);
  return parts.filter((p) => p.length > 0);
}

/** Answers the last user message in `history`. Never throws for an unknown question. */
export async function runBuiltinAssistant({ ctx, history, emit, upgradeHint }: BuiltinRunOptions): Promise<{ intent: Intent }> {
  const users = history.filter((m) => m.role === "user");
  const question = users[users.length - 1]?.content ?? "";
  const names = await knownNames(ctx);
  const previousText = users.length > 1 ? users[users.length - 2].content : null;
  const previous = previousText ? parseQuestion(previousText, { today: ctx.today, ...names }) : null;
  const parsed = parseQuestion(question, { today: ctx.today, ...names, previous });

  const say = (text: string) => {
    for (const c of chunks(text)) emit({ type: "text", text: c });
  };

  if (parsed.intent === "help") {
    say(HELP);
    emit({ type: "suggestions", items: FOLLOW_UPS.help ?? [] });
    return { intent: "help" };
  }
  if (parsed.intent === "unknown") {
    say(
      `I couldn't work out that question with the built-in assistant. It understands questions about spending, income, subscriptions, upcoming payments, budgets, email and your calendar - try one of the suggestions below, or say "help" for the full list.${upgradeHint ? `\n\n${upgradeHint}` : ""}`,
    );
    emit({ type: "suggestions", items: FOLLOW_UPS.unknown ?? [] });
    return { intent: "unknown" };
  }

  const used = new Set<string>();
  const reading = (tool: string) => {
    if (used.has(tool)) return;
    used.add(tool);
    emit({ type: "tool", name: tool, label: TOOL_LABELS[tool] ?? "Working" });
  };
  const answer = await COMPOSERS[parsed.intent](parsed, ctx, question, reading);
  say(answer.text);
  let shown = 0;
  for (const [tool, result] of answer.data ?? []) {
    for (const card of cardsForTool(tool, result, ctx.currency)) {
      if (shown++ >= 5) break;
      emit({ type: "card", card });
    }
  }
  const follow = (FOLLOW_UPS[parsed.intent] ?? []).filter((s) => s.toLowerCase() !== question.trim().toLowerCase());
  if (follow.length) emit({ type: "suggestions", items: follow.slice(0, 3) });
  return { intent: parsed.intent };
}
