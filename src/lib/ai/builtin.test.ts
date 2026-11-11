/**
 * The built-in assistant end to end: understand the question, read the
 * (sample) data from the on-device store, write the answer. No AI, no network.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("@/lib/local/server"));

import { __resetForTests, LOCAL_USER_ID, localDb } from "@/lib/local/db";
import { applyDemoSubscriptionStates, seedDemoData } from "@/lib/demo/seed";
import { runPipeline } from "@/lib/engines/pipeline";
import { runBuiltinAssistant } from "./builtin";
import type { AssistantEvent } from "./events";
import { detectCategory, detectMerchant, parsePeriod, parseQuestion, parseWindow, resolveComparison } from "./nlu";
import type { ToolContext } from "./tools";

const TODAY = new Date(2026, 10, 11, 12); // Wednesday 11 November 2026
const db = localDb as unknown as ToolContext["supabase"];
const ctx: ToolContext = { supabase: db, userId: LOCAL_USER_ID, currency: "EUR", today: TODAY };

describe("understanding questions", () => {
  const intent = (q: string, extra: Partial<Parameters<typeof parseQuestion>[1]> = {}) => parseQuestion(q, { today: TODAY, ...extra }).intent;

  it("recognises the suggested questions", () => {
    expect(intent("How much money did I spend this month?")).toBe("spending_total");
    expect(intent("What did I spend the most money on?")).toBe("top_categories");
    expect(intent("How much did I spend on subscriptions this year?")).toBe("subscriptions_cost");
    expect(intent("What subscriptions am I currently paying for?")).toBe("subscriptions_list");
    expect(intent("What payments are coming up?")).toBe("upcoming_payments");
    expect(intent("How much do I spend on food every month?")).toBe("category_spend");
    expect(intent("What are my biggest recurring expenses?")).toBe("recurring_biggest");
    expect(intent("Which subscriptions haven't I used or interacted with recently?")).toBe("subscriptions_forgotten");
    expect(intent("How much did I spend last month compared to this month?")).toBe("compare");
    expect(intent("What important events do I have next week?")).toBe("events");
  });

  it("recognises everyday phrasings", () => {
    expect(intent("Run a full check-up")).toBe("checkup");
    expect(intent("how am i doing")).toBe("checkup");
    expect(intent("Check my email")).toBe("email_digest");
    expect(intent("anything important in my inbox?")).toBe("email_digest");
    expect(intent("Any deliveries on the way?")).toBe("emails");
    expect(intent("show me receipts from Amazon")).toBe("emails");
    expect(intent("Which subscriptions could I cancel?")).toBe("subscriptions_forgotten");
    expect(intent("Any price increases?")).toBe("price_changes");
    expect(intent("Am I over budget?")).toBe("budgets");
    expect(intent("how much money do i have")).toBe("balance");
    expect(intent("How much did I earn last month?")).toBe("income");
    expect(intent("How much did I save?")).toBe("savings");
    expect(intent("Anything unusual in my spending?")).toBe("unusual");
    expect(intent("was I charged twice anywhere?")).toBe("unusual");
    expect(intent("What were my biggest purchases this month?")).toBe("biggest_purchases");
    expect(intent("Where do I shop the most?")).toBe("top_merchants");
    expect(intent("show my latest transactions")).toBe("recent_transactions");
    expect(intent("what's on tomorrow")).toBe("events");
    expect(intent("what can you do")).toBe("help");
    expect(intent("tell me a joke about cats")).toBe("unknown");
  });

  it("tells merchants, categories and email questions apart", () => {
    const amazon = parseQuestion("How much did I spend on Amazon this year?", { today: TODAY });
    expect(amazon).toMatchObject({ intent: "merchant_spend", merchant: "Amazon", period: { from: "2026-01-01", to: "2026-11-11" } });
    // A merchant the user actually pays is found even in lower case.
    expect(parseQuestion("how much at colruyt last month", { today: TODAY, merchants: ["Colruyt", "Delhaize"] })).toMatchObject({ intent: "merchant_spend", merchant: "Colruyt" });
    expect(parseQuestion("How much did I spend on food last month?", { today: TODAY })).toMatchObject({ intent: "category_spend", categoryIds: ["groceries", "restaurants"], period: { from: "2026-10-01", to: "2026-10-31" } });
    expect(parseQuestion("how much did flights cost me this year", { today: TODAY }).intent).toBe("category_spend");
    expect(detectCategory("my pet costs", [{ id: "c1", name: "Pet costs" }])).toEqual({ ids: ["c1"], label: "Pet costs" });
    expect(detectMerchant("what did I spend on food")).toBeNull();
    expect(detectMerchant("how much at the supermarket")).toBeNull();
  });

  it("carries the question over for follow-ups", () => {
    const first = parseQuestion("How much did I spend on food this month?", { today: TODAY });
    const followUp = parseQuestion("and last month?", { today: TODAY, previous: first });
    expect(followUp).toMatchObject({ intent: "category_spend", categoryIds: ["groceries", "restaurants"], period: { label: "last month" } });
  });

  it("resolves periods", () => {
    const p = (q: string) => {
      const r = parsePeriod(q, TODAY);
      return r ? [r.from, r.to] : null;
    };
    expect(p("this month")).toEqual(["2026-11-01", "2026-11-11"]);
    expect(p("last month")).toEqual(["2026-10-01", "2026-10-31"]);
    expect(p("this year")).toEqual(["2026-01-01", "2026-11-11"]);
    expect(p("last year")).toEqual(["2025-01-01", "2025-12-31"]);
    expect(p("this week")).toEqual(["2026-11-09", "2026-11-11"]);
    expect(p("last week")).toEqual(["2026-11-02", "2026-11-08"]);
    expect(p("yesterday")).toEqual(["2026-11-10", "2026-11-10"]);
    expect(p("in the last 30 days")).toEqual(["2026-10-13", "2026-11-11"]);
    expect(p("past 3 months")).toEqual(["2026-08-12", "2026-11-11"]);
    expect(p("in October")).toEqual(["2026-10-01", "2026-10-31"]);
    expect(p("in december")).toEqual(["2025-12-01", "2025-12-31"]); // not in the future
    expect(p("sept 2025")).toEqual(["2025-09-01", "2025-09-30"]);
    expect(p("since august")).toEqual(["2026-08-01", "2026-11-11"]);
    expect(p("in 2025")).toEqual(["2025-01-01", "2025-12-31"]);
    expect(p("q3")).toEqual(["2026-07-01", "2026-09-30"]);
    expect(p("from 2026-02-01 to 2026-02-15")).toEqual(["2026-02-01", "2026-02-15"]);
    expect(p("what may I do")).toBeNull();
    expect(p("how much did I spend")).toBeNull();
  });

  it("resolves forward-looking windows and comparisons", () => {
    const w = (q: string) => {
      const r = parseWindow(q, TODAY);
      return r ? [r.from, r.to] : null;
    };
    expect(w("next week")).toEqual(["2026-11-16", "2026-11-22"]);
    expect(w("tomorrow")).toEqual(["2026-11-12", "2026-11-12"]);
    expect(w("this week")).toEqual(["2026-11-11", "2026-11-15"]);
    expect(w("in the next 30 days")).toEqual(["2026-11-11", "2026-12-11"]);
    const cmp = resolveComparison("compare this month to last month", TODAY);
    expect([cmp.a.from, cmp.a.to, cmp.b.from, cmp.b.to]).toEqual(["2026-11-01", "2026-11-11", "2026-10-01", "2026-10-11"]);
    const named = resolveComparison("october vs september", TODAY);
    expect([named.a.from, named.b.from]).toEqual(["2026-10-01", "2026-09-01"]);
  });
});

describe("answering from the data", () => {
  beforeAll(async () => {
    __resetForTests();
    await seedDemoData(db, LOCAL_USER_ID, TODAY);
    await runPipeline(db, LOCAL_USER_ID, { demo: true, today: TODAY });
    await applyDemoSubscriptionStates(db, LOCAL_USER_ID, TODAY);
    await runPipeline(db, LOCAL_USER_ID, { demo: true, today: TODAY });
  });

  async function ask(question: string, history: { role: "user" | "assistant"; content: string }[] = []) {
    const events: AssistantEvent[] = [];
    const { intent } = await runBuiltinAssistant({ ctx, history: [...history, { role: "user", content: question }], emit: (e) => events.push(e), upgradeHint: "Add a key for more." });
    const text = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    const cards = events.filter((e) => e.type === "card").map((e) => (e as Extract<AssistantEvent, { type: "card" }>).card);
    return { intent, text, cards, events };
  }

  it("totals spending from the same figures the dashboard uses", async () => {
    const { data } = await localDb.rpc("spending_by_period", { p_from: "2026-11-01", p_to: "2026-11-11", p_grain: "month" });
    const spent = (data as { spent: number }[]).reduce((a, r) => a + Number(r.spent), 0);
    expect(spent).toBeGreaterThan(0);
    const r = await ask("How much money did I spend this month?");
    const formatted = new Intl.NumberFormat("en-BE", { style: "currency", currency: "EUR" }).format(spent);
    expect(r.text).toContain(`You spent **${formatted}** this month`);
    expect(r.text).toContain("sample (demo) data");
    expect(r.cards.map((c) => c.kind)).toEqual(["stats", "bars"]);
    expect(r.events).toContainEqual({ type: "tool", name: "spending_summary", label: "Totalling your spending" });
    expect(r.events.some((e) => e.type === "suggestions")).toBe(true);
  });

  it("answers every kind of question without guessing", async () => {
    const questions: [string, RegExp][] = [
      ["What did I spend the most money on?", /biggest category this month/i],
      ["How much do I spend on food every month?", /a month\*\* on food/],
      ["What subscriptions am I currently paying for?", /You are paying for \*\*\d+ recurring services?\*\*/],
      ["How much did I spend on subscriptions this year?", /subscriptions? cost \*\*€/],
      ["What are my biggest recurring expenses?", /biggest recurring expense is \*\*/],
      ["Which subscriptions haven't I used or interacted with recently?", /can't see whether you actually use a service/],
      ["What payments are coming up?", /payments?\*\* expected the next 2 weeks/],
      ["How much did I spend last month compared to this month?", /this month so far[\s\S]*against[\s\S]*the same days last month/],
      ["What important events do I have next week?", /planned next week|Nothing is planned next week/],
      ["How much did I earn last month?", /You received \*\*€[\d,.]+\*\* last month/],
      ["How much did I save?", /net result of \*\*/],
      ["What were my biggest purchases this month?", /biggest expense this month/],
      ["Where do I shop the most?", /merchant you paid the most the last 3 months/],
      ["Anything unusual in my spending?", /stands out in the last 45 days/],
      ["Check my email", /emails? worth knowing about|Nothing important arrived/],
      ["Any deliveries on the way?", /delivery emails?/],
      ["how much money do i have", /Across \d+ accounts? you have \*\*€/],
      ["show my latest transactions", /most recent transactions/],
      ["Run a full check-up", /\*\*Money this month\*\*[\s\S]*\*\*Subscriptions and fixed costs\*\*[\s\S]*\*\*Next 14 days\*\*/],
      ["what data do you have", /transactions? from/],
    ];
    for (const [q, pattern] of questions) {
      const r = await ask(q);
      expect(r.intent, q).not.toBe("unknown");
      expect(r.text, q).toMatch(pattern);
      expect(r.text, q).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it("uses a named merchant and period, and follows up", async () => {
    const { data } = await localDb.from("transactions").select("merchant").eq("is_demo", true).lt("amount", 0).not("merchant", "is", null).limit(1);
    const merchant = (data as { merchant: string }[])[0].merchant;
    const first = await ask(`How much did I spend at ${merchant} this year?`);
    expect(first.intent).toBe("merchant_spend");
    expect(first.text).toMatch(new RegExp(`at ${merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} this year`));
    const next = await ask("and last month?", [{ role: "user", content: `How much did I spend at ${merchant} this year?` }, { role: "assistant", content: first.text }]);
    expect(next.intent).toBe("merchant_spend");
    expect(next.text).toContain("last month");
  });

  it("says so plainly when it can't answer, and never invents one", async () => {
    const r = await ask("write me a poem about my bank");
    expect(r.intent).toBe("unknown");
    expect(r.text).toContain("couldn't work out that question");
    expect(r.text).toContain("Add a key for more.");
    expect(r.cards).toEqual([]);
  });

  it("explains an empty store instead of showing zeros", async () => {
    __resetForTests();
    const r = await ask("How much did I spend this month?");
    expect(r.text).toContain("I found no transactions for this month");
    expect(r.text).toContain("import a bank CSV");
    const mail = await ask("Check my email");
    expect(mail.text).toContain("No mailbox is connected yet");
  });
});
