import type { DataCard } from "./cards";

/** Which engine produced an answer: the built-in one (no AI, no key) or Claude. */
export type AssistantEngine = "builtin" | "claude";

/** Events streamed to the chat UI as newline-delimited JSON. */
export type AssistantEvent =
  | { type: "engine"; engine: AssistantEngine; model?: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "card"; card: DataCard }
  | { type: "suggestions"; items: string[] }
  | { type: "usage"; input_tokens: number; output_tokens: number; cost_usd: number | null }
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
  search_emails: "Searching your email data",
  get_insights: "Reading your insights",
  account_balances: "Checking balances",
  income_summary: "Adding up income",
  budget_status: "Checking budgets",
  cash_flow: "Comparing money in and out",
  unusual_activity: "Looking for unusual charges",
  email_digest: "Going through recent email",
  data_sources: "Checking what's connected",
  alerts: "Reading your alerts",
  full_checkup: "Running a full check-up",
};
