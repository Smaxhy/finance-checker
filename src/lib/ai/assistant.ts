import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AI_MODEL, FALLBACK_BETA } from "./client";
import {
  toolCategoryTrend,
  toolComparePeriods,
  toolInsights,
  toolListSubscriptions,
  toolListTransactions,
  toolSearchEmails,
  toolSpendingByCategory,
  toolSpendingByMerchant,
  toolSpendingSummary,
  toolUpcoming,
  type ToolContext,
} from "./tools";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "notice"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export const TOOL_LABELS: Record<string, string> = {
  spending_summary: "Totalling your spending",
  spending_by_category: "Breaking spending down by category",
  category_trend: "Looking at monthly trends",
  spending_by_merchant: "Looking at merchants",
  list_transactions: "Looking at transactions",
  compare_periods: "Comparing periods",
  list_subscriptions: "Checking subscriptions",
  upcoming: "Checking what's coming up",
  search_emails: "Searching extracted email data",
  get_insights: "Reading your insights",
};

/** Tool results are JSON; errors become a short message the model can relay. */
async function json(fn: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify(await fn());
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "Tool failed" });
  }
}

export function buildTools(ctx: ToolContext) {
  return [
    betaZodTool({
      name: "spending_summary",
      description: "Total spending, income, refunds and net for a date range, with a per-month breakdown and average daily spending.",
      inputSchema: z.object({ from: isoDate, to: isoDate }),
      run: (i) => json(() => toolSpendingSummary(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "spending_by_category",
      description: "Spending per category for a date range, largest first, with share of total. Use for 'what did I spend the most on'.",
      inputSchema: z.object({ from: isoDate, to: isoDate }),
      run: (i) => json(() => toolSpendingByCategory(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "category_trend",
      description:
        "Monthly spending for ONE category over the last N months plus the average of complete months. Category ids: groceries, restaurants, shopping, entertainment, transport, travel, subscriptions, housing, bills, business, health, cash, other. Use groceries (+ restaurants if asked about food overall) for 'food'.",
      inputSchema: z.object({ category_id: z.string().min(1).max(64), months: z.number().int().min(1).max(24) }),
      run: (i) => json(() => toolCategoryTrend(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "spending_by_merchant",
      description: "Without `merchant`: top merchants by amount for a date range. With `merchant` (e.g. 'Amazon'): total spent there, number of purchases, first/last purchase date.",
      inputSchema: z.object({ from: isoDate, to: isoDate, merchant: z.string().min(1).max(80).optional(), limit: z.number().int().min(1).max(50).optional() }),
      run: (i) => json(() => toolSpendingByMerchant(ctx, i)),
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
      run: (i) => json(() => toolListTransactions(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "compare_periods",
      description: "Compare spending and income between period A and period B, overall and per category. For month-to-date comparisons use the same number of days in both periods.",
      inputSchema: z.object({ a_from: isoDate, a_to: isoDate, b_from: isoDate, b_to: isoDate }),
      run: (i) => json(() => toolComparePeriods(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "list_subscriptions",
      description:
        "Subscriptions and recurring bills with amount, billing cycle, monthly/yearly equivalents, next payment date, status and a 'possibly_forgotten' flag. Sorted by monthly cost (biggest recurring expenses first).",
      inputSchema: z.object({ status: z.enum(["active", "trial", "cancellation_pending", "cancelled", "paused", "expired", "all"]).optional() }),
      run: (i) => json(() => toolListSubscriptions(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "upcoming",
      description: "Upcoming subscription renewals, bills, trial endings, cancellation deadlines, calendar events and tasks in a window of `days` starting `from` (default today).",
      inputSchema: z.object({ days: z.number().int().min(1).max(120), from: isoDate.optional() }),
      run: (i) => json(() => toolUpcoming(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "search_emails",
      description:
        "Search structured data extracted from emails (receipts, orders, shipping, subscriptions, trials, renewals, bills, bookings, travel, appointments). Returns merchant, amount, dates, order numbers - never email bodies.",
      inputSchema: z.object({
        query: z.string().max(80).optional(),
        category: z
          .enum(["receipt", "purchase", "order", "shipping", "subscription", "trial", "renewal", "cancellation", "bill", "booking", "travel", "appointment", "important", "other"])
          .optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      run: (i) => json(() => toolSearchEmails(ctx, i)),
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "get_insights",
      description: "Pre-computed observations about the user's finances this month (changes vs last month, unusual categories, similar subscriptions, price increases, trials ending).",
      inputSchema: z.object({}),
      run: () => json(() => toolInsights(ctx)),
      eager_input_streaming: true,
    }),
  ];
}

const STABLE_SYSTEM = `You are the analysis assistant inside "Command Centre", a personal finance and life-admin dashboard. You answer questions about the user's own money, subscriptions, emails and plans.

Rules:
- Answer ONLY from tool results. Never estimate, extrapolate or invent figures, merchants, dates or events. If the tools return no data (empty: true) say so plainly and suggest connecting the relevant source (bank, Gmail, calendar) in Settings > Connected Accounts.
- Call tools first; you may call several. Prefer exact periods (YYYY-MM-DD) and state the period you used ("1-9 November 2026").
- Spending excludes transfers between the user's own accounts; refunds reduce spending. Mention this only when relevant.
- If results include demo data (is_demo / includes_demo_data), say the figures include sample data.
- "Not used / interacted with recently" for subscriptions: the app cannot see actual usage, only that no email from the provider and no review happened in 90 days. Say that.
- You cannot send emails, make payments, change or cancel subscriptions, or modify anything. If asked, explain where in the app the user can do it (e.g. Subscriptions > the subscription > Cancellation) and that nothing is cancelled until they confirm it.
- Be concise and concrete: lead with the answer and the number, then 2-5 short bullets of supporting detail when helpful. Format money with the currency symbol (e.g. €1,234.56). Use plain text with simple "- " bullets and **bold** only; no tables, no headings.`;

export interface AssistantRunOptions {
  client: Anthropic;
  ctx: ToolContext;
  history: { role: "user" | "assistant"; content: string }[];
  emit: (e: AssistantEvent) => void;
  signal?: AbortSignal;
}

class TruncatedToolInput extends Error {}

export async function runAssistant({ client, ctx, history, emit, signal }: AssistantRunOptions): Promise<void> {
  const today = ctx.today;
  const dayName = today.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/Brussels" });
  const context = `Today is ${dayName} ${today.toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" })} (timezone Europe/Brussels; weeks start on Monday). Base currency: ${ctx.currency}.`;

  const baseParams = {
    model: AI_MODEL,
    max_tokens: 64000,
    // Stable block first (cacheable), the volatile date line after it.
    system: [
      { type: "text" as const, text: STABLE_SYSTEM },
      { type: "text" as const, text: context },
    ],
    cache_control: { type: "ephemeral" as const },
    output_config: { effort: "medium" as const },
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    tools: buildTools(ctx),
    max_iterations: 8,
    // Send the full (short, client-held) history each turn rather than using server-side message threads.
    thread: false as const,
    betas: [FALLBACK_BETA],
    fallbacks: "default" as const,
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
}

export function describeAssistantError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The AI provider rejected the API key. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError) return "The AI provider is rate limiting requests. Try again in a minute.";
  if (err instanceof Anthropic.BadRequestError) return "The request to the AI provider was rejected.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the AI provider.";
  if (err instanceof Anthropic.APIError) return `The AI provider returned an error (${err.status ?? "unknown"}).`;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
