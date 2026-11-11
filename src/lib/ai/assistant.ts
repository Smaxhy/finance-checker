// Holds no secrets: the Anthropic client and the user-scoped data client are passed in,
// so this runs on the server (full edition) and in the browser (GitHub Pages edition).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { cardsForTool } from "./cards";
import { TOOL_LABELS, type AssistantEvent } from "./events";
import { FALLBACK_BETA, estimateCostUsd, supportsServerFallback, type AiEffort } from "./models";
import {
  toolAccounts,
  toolBudgets,
  toolCashFlow,
  toolCategoryTrend,
  toolCheckup,
  toolComparePeriods,
  toolEmailDigest,
  toolIncome,
  toolInsights,
  toolListSubscriptions,
  toolListTransactions,
  toolNotifications,
  toolSearchEmails,
  toolSources,
  toolSpendingByCategory,
  toolSpendingByMerchant,
  toolSpendingSummary,
  toolUnusual,
  toolUpcoming,
  type ToolContext,
} from "./tools";

export { TOOL_LABELS, type AssistantEvent } from "./events";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Called with every tool result, so the UI can draw cards from the exact data the model saw. */
type OnResult = (tool: string, result: unknown) => void;

export function buildTools(ctx: ToolContext, onResult?: OnResult) {
  /** Tool results are JSON; errors become a short message the model can relay. */
  const run = async (tool: string, fn: () => Promise<unknown>): Promise<string> => {
    try {
      const result = await fn();
      onResult?.(tool, result);
      return JSON.stringify(result);
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : "Tool failed" });
    }
  };
  return [
    betaZodTool({
      name: "spending_summary",
      description: "Total spending, income, refunds and net for a date range, with a per-month breakdown and average daily spending.",
      inputSchema: z.object({ from: isoDate, to: isoDate }),
      run: (i) => run("spending_summary", () => toolSpendingSummary(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "spending_by_category",
      description: "Spending per category for a date range, largest first, with share of total. Use for 'what did I spend the most on'.",
      inputSchema: z.object({ from: isoDate, to: isoDate }),
      run: (i) => run("spending_by_category", () => toolSpendingByCategory(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "category_trend",
      description:
        "Monthly spending for ONE category over the last N months plus the average of complete months. Category ids: groceries, restaurants, shopping, entertainment, transport, travel, subscriptions, housing, bills, business, health, cash, other. Use groceries (+ restaurants if asked about food overall) for 'food'.",
      inputSchema: z.object({ category_id: z.string().min(1).max(64), months: z.number().int().min(1).max(24) }),
      run: (i) => run("category_trend", () => toolCategoryTrend(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "spending_by_merchant",
      description: "Without `merchant`: top merchants by amount for a date range. With `merchant` (e.g. 'Amazon'): total spent there, number of purchases, first/last purchase date.",
      inputSchema: z.object({ from: isoDate, to: isoDate, merchant: z.string().min(1).max(80).optional(), limit: z.number().int().min(1).max(50).optional() }),
      run: (i) => run("spending_by_merchant", () => toolSpendingByMerchant(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "list_transactions",
      description: "List individual transactions with optional filters. sort='amount' returns the largest first (e.g. biggest purchases). Max 50 rows.",
      inputSchema: z.object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        category_id: z.string().max(64).optional(),
        merchant: z.string().max(80).optional(),
        kind: z.enum(["expense", "income", "transfer", "refund", "withdrawal", "fee", "spending"]).optional(),
        min_amount: z.number().positive().optional(),
        sort: z.enum(["date", "amount"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      run: (i) => run("list_transactions", () => toolListTransactions(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "compare_periods",
      description: "Compare spending and income between period A and period B, overall and per category. For month-to-date comparisons use the same number of days in both periods.",
      inputSchema: z.object({ a_from: isoDate, a_to: isoDate, b_from: isoDate, b_to: isoDate }),
      run: (i) => run("compare_periods", () => toolComparePeriods(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "list_subscriptions",
      description:
        "Subscriptions and recurring bills with amount, billing cycle, monthly/yearly equivalents, next payment date, status and a 'possibly_forgotten' flag. Sorted by monthly cost (biggest recurring expenses first).",
      inputSchema: z.object({ status: z.enum(["active", "trial", "cancellation_pending", "cancelled", "paused", "expired", "all"]).optional() }),
      run: (i) => run("list_subscriptions", () => toolListSubscriptions(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "upcoming",
      description: "Upcoming subscription renewals, bills, trial endings, cancellation deadlines, calendar events and tasks in a window of `days` starting `from` (default today).",
      inputSchema: z.object({ days: z.number().int().min(1).max(120), from: isoDate.optional() }),
      run: (i) => run("upcoming", () => toolUpcoming(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "search_emails",
      description:
        "Search structured data extracted from emails in all connected mailboxes (receipts, orders, shipping, subscriptions, trials, renewals, bills, bookings, travel, appointments). Returns merchant, amount, dates, order numbers and which mailbox each came from - never email bodies.",
      inputSchema: z.object({
        query: z.string().max(80).optional(),
        category: z
          .enum(["receipt", "purchase", "order", "shipping", "subscription", "trial", "renewal", "cancellation", "bill", "booking", "travel", "appointment", "important", "other"])
          .optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        limit: z.number().int().min(1).max(100).optional(),
        account: z.string().max(120).optional().describe("Only this mailbox: (part of) the email address of a connected account"),
      }),
      run: (i) => run("search_emails", () => toolSearchEmails(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "account_balances",
      description: "Bank accounts with their latest known balance and the total per currency. Use for 'how much money do I have'.",
      inputSchema: z.object({}),
      run: () => run("account_balances", () => toolAccounts(ctx)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "income_summary",
      description: "Income for a date range: total, number of payments, average per month and a breakdown by source (employer, benefits, other).",
      inputSchema: z.object({ from: isoDate, to: isoDate }),
      run: (i) => run("income_summary", () => toolIncome(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "budget_status",
      description: "The user's monthly budgets for the current month: limit, spent so far, remaining, share used and a projected month-end figure at the current pace.",
      inputSchema: z.object({}),
      run: () => run("budget_status", () => toolBudgets(ctx)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "cash_flow",
      description: "Income, spending, net result and savings rate per month for the last N months, with averages over complete months. Use for savings, 'am I spending more than I earn' and trends over time.",
      inputSchema: z.object({ months: z.number().int().min(1).max(24) }),
      run: (i) => run("cash_flow", () => toolCashFlow(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "unusual_activity",
      description: "Things worth a second look in the last `days` days (default 45): possible duplicate charges, purchases above the user's large-purchase threshold, and sizeable payments to merchants never paid before.",
      inputSchema: z.object({ days: z.number().int().min(7).max(180).optional() }),
      run: (i) => run("unusual_activity", () => toolUnusual(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "email_digest",
      description:
        "What arrived in the connected mailboxes in the last `days` days (default 7), grouped: bills to pay (with due dates), trials and renewals, deliveries, bookings and appointments, receipts and orders, cancellations, other important mail - with a count per mailbox. Use for 'check my email', 'anything important in my inbox', 'what did I miss'.",
      inputSchema: z.object({ days: z.number().int().min(1).max(60).optional() }),
      run: (i) => run("email_digest", () => toolEmailDigest(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "data_sources",
      description: "Which sources are connected (mailboxes, calendars, banks), when each was last checked, any connection problem, and how much data is stored and for which dates. Call this when a result is empty, to explain what is missing.",
      inputSchema: z.object({}),
      run: () => run("data_sources", () => toolSources(ctx)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "alerts",
      description: "The user's in-app alerts (upcoming payments, trials ending, price increases, large purchases, charges after cancellation...). Unread only by default.",
      inputSchema: z.object({ unread_only: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }),
      run: (i) => run("alerts", () => toolNotifications(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "full_checkup",
      description:
        "Everything worth looking at in ONE call: this month vs the same days last month, top categories and biggest changes, balances, subscriptions (cost, trials, possibly forgotten, pending cancellations), the next 14 days, unusual charges, budgets at risk, the last 14 days of email, unread alerts and connected sources. Use it for broad requests ('check everything', 'how am I doing', 'give me an overview', 'what should I know') and then call narrower tools only where you need more detail.",
      inputSchema: z.object({}),
      run: () => run("full_checkup", () => toolCheckup(ctx)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "get_insights",
      description: "Pre-computed observations about the user's finances this month (changes vs last month, unusual categories, similar subscriptions, price increases, trials ending).",
      inputSchema: z.object({}),
      run: () => run("get_insights", () => toolInsights(ctx)),
      eager_input_streaming: true,
    }),
  ];
}

const STABLE_SYSTEM = `You are the analysis assistant inside "Command Centre", a personal finance and life-admin dashboard. You answer questions about the user's own money, subscriptions, emails and plans, and you look things over for them when asked.

Where the facts come from:
- Answer ONLY from tool results. Never estimate, extrapolate or invent figures, merchants, dates or events. A projection a tool returns (for example a budget's projected month-end figure) may be quoted, labelled as a projection.
- Call tools first; you may call several, in parallel when they are independent. For broad requests ("check everything", "how am I doing", "what should I know") start with full_checkup, then dig into whatever stands out with the narrower tools.
- Prefer exact periods (YYYY-MM-DD) and state the period you used ("1-9 November 2026").
- If a tool returns no data (empty: true), say so plainly. Call data_sources to see what is connected, and tell the user what to add under Settings > Connected Accounts or by importing a bank CSV under Finances > Transactions.
- Spending excludes transfers between the user's own accounts; refunds reduce spending. Mention this only when relevant.
- If results include demo data (is_demo / includes_demo_data), say the figures include sample data.
- Email: only structured fields from transactional and important emails are stored, never bodies, and you cannot tell from an email whether a bill was paid. When several mailboxes are connected, say which mailbox something came from when it helps.
- "Not used / interacted with recently" for subscriptions: the app cannot see actual usage, only that no email from the provider and no review happened in 90 days. Say that.

What you cannot do:
- You cannot send emails, make payments, move money, change or cancel subscriptions, or modify anything. If asked, explain where in the app the user can do it (for example Subscriptions > the subscription > Cancellation) and that nothing is cancelled until they confirm it themselves.
- You are not a financial adviser. You can point out what the data shows and practical options (a subscription that looks forgotten, a category running above its usual level, a bill coming due); leave investment, tax and legal decisions to the user.

How to answer:
- Lead with the direct answer and its key number. Then give the detail that helps the user understand it: the breakdown, how it compares with the previous period or their usual level, and anything notable in the data.
- Match the length to the question. A simple lookup gets a sentence or two. A broad review gets a structured report with a short section per area, covering everything the data shows to be worth attention.
- Close with up to three concrete next steps only when the data supports them, each tied to a figure from the tools.
- The app draws charts and tables of your tool results underneath your answer, so do not repeat long lists row by row: summarise them and point out what matters.
- Format money with the currency symbol (for example €1,234.56). Use short paragraphs, "- " bullets, **bold** for key figures, short bold section titles on their own line for long answers, and a small table (| a | b |) when comparing several items across the same columns.`;

export interface AssistantRunOptions {
  client: Anthropic;
  /** Model id, e.g. "claude-opus-5-5". */
  model: string;
  /** How much reasoning to spend per answer. */
  effort?: AiEffort;
  ctx: ToolContext;
  history: { role: "user" | "assistant"; content: string }[];
  emit: (e: AssistantEvent) => void;
  signal?: AbortSignal;
}

/** Follow-up questions offered after an answer, chosen from the tools it used. */
const FOLLOW_UPS: Record<string, string[]> = {
  full_checkup: ["Which subscriptions could I cancel?", "Anything unusual in my spending?"],
  spending_summary: ["What did I spend the most on?", "Compare this month to last month"],
  spending_by_category: ["Where do I shop the most?", "Am I over budget?"],
  compare_periods: ["What were my biggest purchases this month?"],
  list_subscriptions: ["Which subscriptions could I cancel?", "What payments are coming up?"],
  upcoming: ["What subscriptions am I paying for?"],
  email_digest: ["What payments are coming up?", "Any deliveries on the way?"],
  search_emails: ["Check my email"],
  cash_flow: ["What are my biggest recurring expenses?"],
  unusual_activity: ["What were my biggest purchases this month?"],
};

class TruncatedToolInput extends Error {}

export async function runAssistant({ client, model, effort = "medium", ctx, history, emit, signal }: AssistantRunOptions): Promise<void> {
  const today = ctx.today;
  const dayName = today.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/Brussels" });
  const context = `Today is ${dayName} ${today.toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" })} (timezone Europe/Brussels; weeks start on Monday). Base currency: ${ctx.currency}.`;

  // Cards are drawn from tool results as they arrive: at most 5 per answer, one set per tool.
  const toolsUsed: string[] = [];
  let cardCount = 0;
  const onResult = (tool: string, result: unknown) => {
    if (toolsUsed.includes(tool)) return;
    toolsUsed.push(tool);
    for (const card of cardsForTool(tool, result, ctx.currency)) {
      if (cardCount >= 5) return;
      cardCount++;
      emit({ type: "card", card });
    }
  };
  const usage = { input: 0, output: 0, cost: 0 as number | null };

  const baseParams = {
    model,
    max_tokens: 64000,
    // Stable block first (cacheable), the volatile date line after it.
    system: [
      { type: "text" as const, text: STABLE_SYSTEM },
      { type: "text" as const, text: context },
    ],
    cache_control: { type: "ephemeral" as const },
    output_config: { effort },
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    tools: buildTools(ctx, onResult),
    max_iterations: 10,
    // Send the full (short, client-held) history each turn rather than using server-side message threads.
    thread: false as const,
    // If a request is declined, the API re-runs it on a suitable model (not offered for every model).
    ...(supportsServerFallback(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };

  let runner = client.beta.messages.toolRunner({ ...baseParams, stream: true }, { signal });
  for (let attempt = 0; ; attempt++) {
    try {
      for await (const messageStream of runner) {
        for await (const event of messageStream) {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            emit({ type: "tool", name: event.content_block.name, label: TOOL_LABELS[event.content_block.name] ?? "Working" });
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            emit({ type: "text", text: event.delta.text });
          }
        }
        const message = await messageStream.finalMessage();
        attempt = 0;
        const u = message.usage;
        usage.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        usage.output += u.output_tokens ?? 0;
        const cost = estimateCostUsd(message.model, u);
        usage.cost = cost === null || usage.cost === null ? null : usage.cost + cost;
        const hasToolUse = message.content.some((b) => b.type === "tool_use");
        if (message.stop_reason === "max_tokens" && hasToolUse) throw new TruncatedToolInput("The answer was cut off - try a narrower question.");
        if (message.stop_reason === "refusal") {
          emit({ type: "notice", text: "The assistant declined to answer this request." });
          break;
        }
        if (message.stop_reason === "max_tokens") emit({ type: "notice", text: "The answer was cut short." });
      }
      break;
    } catch (err) {
      if (err instanceof Anthropic.APIError || err instanceof TruncatedToolInput || attempt >= 2 || signal?.aborted) throw err;
      // A tool input that couldn't be parsed at all: re-issue the turn with the conversation so far.
      runner = client.beta.messages.toolRunner({ ...runner.params, stream: true }, { signal });
    }
  }

  if (usage.input || usage.output) emit({ type: "usage", input_tokens: usage.input, output_tokens: usage.output, cost_usd: usage.cost === null ? null : Math.round(usage.cost * 10000) / 10000 });
  const asked = history[history.length - 1]?.content.trim().toLowerCase();
  const follow = [...new Set(toolsUsed.flatMap((t) => FOLLOW_UPS[t] ?? []))].filter((q) => q.toLowerCase() !== asked).slice(0, 3);
  if (follow.length) emit({ type: "suggestions", items: follow });
}

export function describeAssistantError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key - check that it was copied completely and is still active.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use the selected model.";
  if (err instanceof Anthropic.NotFoundError) return "The selected AI model isn't available for this API key.";
  if (err instanceof Anthropic.RateLimitError) return "Anthropic is rate limiting requests for this key. Try again in a minute.";
  if (err instanceof Anthropic.BadRequestError) return /credit|billing|balance/i.test(err.message) ? "The Anthropic account has no credit left. Add credit in the Anthropic Console." : "Anthropic rejected the request.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach Anthropic. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Anthropic returned an error (${err.status ?? "unknown"}).`;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
