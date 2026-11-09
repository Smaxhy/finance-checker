import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";
import { compareCategoryLists, normaliseRange, pctDiff, shapeSubscriptions, totalsFromPoints, type SubscriptionRow } from "./tools";
import { csvNumber, csvText } from "@/app/api/reports/csv";

describe("rate limiter", () => {
  it("allows up to the limit inside the window, then blocks until it slides", () => {
    const rl = createRateLimiter(2, 1000);
    expect(rl.check("u", 0).allowed).toBe(true);
    expect(rl.check("u", 100).allowed).toBe(true);
    const blocked = rl.check("u", 200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(800);
    expect(rl.check("other", 200).allowed).toBe(true);
    expect(rl.check("u", 1001).allowed).toBe(true);
  });
});

describe("assistant tool helpers", () => {
  it("normalises date ranges and rejects bad input", () => {
    expect(normaliseRange("2026-11-30", "2026-11-01")).toEqual({ from: "2026-11-01", to: "2026-11-30", days: 30 });
    expect(() => normaliseRange("2020-01-01", "2026-01-01")).toThrow(/too long/);
    expect(() => normaliseRange("nope", "2026-01-01")).toThrow();
  });

  it("totals period points exactly", () => {
    expect(
      totalsFromPoints([
        { spent: 100.1, income: 0, refunds: 0, tx_count: 3 },
        { spent: 50.2, income: 3450, refunds: 10, tx_count: 4 },
      ]),
    ).toEqual({ spent: 150.3, income: 3450, refunds: 10, net: 3299.7, transactions: 7 });
  });

  it("computes percentage differences", () => {
    expect(pctDiff(132, 100)).toBe(32);
    expect(pctDiff(5, 0)).toBeNull();
  });

  it("compares categories across periods, biggest change first", () => {
    const res = compareCategoryLists(
      [
        { category_id: "restaurants", spent: 264 },
        { category_id: "groceries", spent: 300 },
      ],
      [
        { category_id: "restaurants", spent: 200 },
        { category_id: "travel", spent: 129.98 },
      ],
      new Map([["restaurants", "Restaurants & takeaway"]]),
    );
    expect(res[0]).toMatchObject({ category: "groceries", period_a: 300, period_b: 0, change_pct: null });
    expect(res.find((r) => r.category === "Restaurants & takeaway")).toMatchObject({ difference: 64, change_pct: 32 });
  });

  it("shapes subscriptions with equivalents and an honest 'possibly forgotten' flag", () => {
    const today = new Date(2026, 10, 9);
    const row = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
      id: "x",
      name: "X",
      amount: "10",
      currency: "EUR",
      billing_cycle: "monthly",
      status: "active",
      category_id: "subscriptions",
      next_payment_date: null,
      last_payment_date: null,
      trial_ends_at: null,
      detection_source: "bank",
      last_email_at: null,
      last_reviewed_at: null,
      user_confirmed: false,
      cancellation_requested_at: null,
      cancellation_confirmed_at: null,
      payment_method: null,
      is_demo: false,
      ...over,
    });
    const res = shapeSubscriptions(
      [
        row({ name: "Deezer", amount: "11.99" }),
        row({ name: "M365", amount: 99, billing_cycle: "yearly", last_email_at: "2026-11-07T10:00:00Z" }),
        row({ name: "Rent", amount: 1150, category_id: "housing", last_reviewed_at: "2026-10-30T10:00:00Z" }),
        row({ name: "Streamz", amount: 12.99, status: "cancelled" }),
      ],
      today,
    );
    expect(res.items[0].name).toBe("Rent");
    expect(res.items.find((i) => i.name === "M365")).toMatchObject({ monthly_equivalent: 8.25, yearly_equivalent: 99, possibly_forgotten: false });
    expect(res.items.find((i) => i.name === "Deezer")?.possibly_forgotten).toBe(true);
    expect(res.items.find((i) => i.name === "Streamz")?.possibly_forgotten).toBe(false);
    expect(res.totals_for_active).toEqual({ count: 3, monthly: 1170.24, yearly: 14042.88 });
  });
});

describe("CSV export", () => {
  it("neutralises formula injection and escapes delimiters", () => {
    expect(csvText("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvText("+32 470")).toBe("'+32 470");
    expect(csvText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvText("Colruyt, Leuven")).toBe('"Colruyt, Leuven"');
    expect(csvText("line\nbreak")).toBe('"line\nbreak"');
    expect(csvText(null)).toBe("");
    expect(csvText("Delhaize")).toBe("Delhaize");
  });
  it("keeps signed amounts numeric", () => {
    expect(csvNumber(-12.5)).toBe("-12.50");
    expect(csvNumber("3450")).toBe("3450.00");
    expect(csvNumber(null)).toBe("");
  });
});
