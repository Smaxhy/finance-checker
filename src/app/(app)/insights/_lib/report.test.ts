import { describe, expect, it } from "vitest";
import { monthKeys, projectSubscriptionsIntoMonth, savingsRate, shiftMonth, splitRecurringByMonth, weekdayAverages } from "./report";

describe("weekdayAverages", () => {
  it("averages per weekday, Monday first", () => {
    // 2026-11-02 is a Monday, 2026-11-09 the next Monday.
    const res = weekdayAverages([
      { period: "2026-11-02", spent: 10 },
      { period: "2026-11-09", spent: 30 },
      { period: "2026-11-08", spent: 7 },
    ]);
    expect(res[0]).toMatchObject({ label: "Mon", average: 20, days: 2 });
    expect(res[6]).toMatchObject({ label: "Sun", average: 7, days: 1 });
    expect(res[2].average).toBe(0);
  });
});

describe("splitRecurringByMonth", () => {
  it("separates fixed commitments from variable spending and nets refunds", () => {
    const res = splitRecurringByMonth(
      [
        { booked_at: "2026-10-01", amount: -1150, kind: "expense", category_id: "housing", subscription_id: null },
        { booked_at: "2026-10-07", amount: -15.99, kind: "expense", category_id: "subscriptions", subscription_id: "s1" },
        { booked_at: "2026-10-12", amount: -40, kind: "expense", category_id: "groceries", subscription_id: null },
        { booked_at: "2026-10-15", amount: 10, kind: "refund", category_id: "shopping", subscription_id: null },
        { booked_at: "2026-10-26", amount: -400, kind: "transfer", category_id: "transfers", subscription_id: null },
        { booked_at: "2026-09-30", amount: -99, kind: "expense", category_id: "groceries", subscription_id: null },
      ],
      ["2026-10"],
    );
    expect(res).toEqual([{ month: "2026-10", recurring: 1165.99, variable: 30 }]);
  });
});

describe("projectSubscriptionsIntoMonth", () => {
  const base = { currency: "EUR", trial_ends_at: null, is_demo: false };
  it("rolls monthly and yearly next-payment dates into the target month", () => {
    const res = projectSubscriptionsIntoMonth(
      [
        { ...base, id: "a", name: "Netflix", amount: 15.99, billing_cycle: "monthly", status: "active", next_payment_date: "2026-11-07" },
        { ...base, id: "b", name: "M365", amount: 99, billing_cycle: "yearly", status: "active", next_payment_date: "2026-12-03" },
        { ...base, id: "c", name: "Prime", amount: 89.9, billing_cycle: "yearly", status: "active", next_payment_date: "2027-07-12" },
        { ...base, id: "d", name: "Old", amount: 5, billing_cycle: "monthly", status: "cancelled", next_payment_date: "2026-12-01" },
        { ...base, id: "e", name: "Gym", amount: 10, billing_cycle: "weekly", status: "active", next_payment_date: "2026-11-30" },
      ],
      "2026-12-01",
      "2026-12-31",
    );
    expect(res.map((r) => [r.name, r.date])).toEqual([
      ["M365", "2026-12-03"],
      ["Gym", "2026-12-07"],
      ["Netflix", "2026-12-07"],
      ["Gym", "2026-12-14"],
      ["Gym", "2026-12-21"],
      ["Gym", "2026-12-28"],
    ]);
  });

  it("includes trials converting during the month", () => {
    const res = projectSubscriptionsIntoMonth(
      [{ ...base, id: "t", name: "Audible", amount: 9.95, billing_cycle: "monthly", status: "trial", next_payment_date: "2026-11-14", trial_ends_at: "2026-11-14" }],
      "2026-11-01",
      "2026-11-30",
    );
    expect(res).toHaveLength(1);
    expect(res[0].name).toContain("trial");
  });
});

describe("misc", () => {
  it("computes savings rate only with income", () => {
    expect(savingsRate(1000, 750)).toBe(0.25);
    expect(savingsRate(0, 100)).toBeNull();
  });
  it("builds month keys", () => {
    expect(monthKeys("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
