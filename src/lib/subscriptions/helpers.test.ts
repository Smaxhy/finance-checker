import { describe, expect, it } from "vitest";
import type { Subscription } from "@/lib/types";
import {
  buildTimeline,
  cancelSteps,
  computeAttention,
  computeTotals,
  GENERIC_CANCEL_STEPS,
  latestPriceChange,
  normalizeSubscription,
  possiblyForgotten,
  renewalsWithin,
} from "./helpers";

const today = new Date(2026, 10, 9); // 9 Nov 2026

function sub(over: Partial<Subscription>): Subscription {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    user_id: "u",
    name: "Service",
    provider: null,
    merchant_key: "service",
    category_id: "subscriptions",
    amount: 10,
    currency: "EUR",
    billing_cycle: "monthly",
    status: "active",
    next_payment_date: "2026-11-20",
    last_payment_date: "2026-10-20",
    last_payment_amount: 10,
    previous_amount: null,
    price_changed_at: null,
    started_at: "2026-01-20",
    trial_ends_at: null,
    payment_method: null,
    cancel_url: null,
    cancel_instructions: null,
    cancellation_deadline: null,
    cancellation_requested_at: null,
    cancellation_confirmed_at: null,
    cancellation_reference: null,
    detection_source: "bank",
    detection_confidence: 0.9,
    charge_count: 10,
    last_email_at: null,
    user_confirmed: true,
    dismissed: false,
    last_reviewed_at: "2026-10-01T10:00:00Z",
    notes: null,
    is_demo: false,
    created_at: "2026-02-01T10:00:00Z",
    ...over,
  };
}

describe("normalizeSubscription", () => {
  it("converts numeric strings", () => {
    const s = normalizeSubscription({ ...sub({}), amount: "12.50", previous_amount: null, charge_count: "3" } as unknown as Record<string, unknown>);
    expect(s.amount).toBe(12.5);
    expect(s.charge_count).toBe(3);
    expect(s.previous_amount).toBeNull();
  });
});

describe("computeTotals", () => {
  it("splits subscriptions from bills and excludes trials, cancelled and dismissed", () => {
    const t = computeTotals([
      sub({ amount: 12, category_id: "subscriptions" }),
      sub({ amount: 120, billing_cycle: "yearly" }),
      sub({ amount: 1150, category_id: "housing" }),
      sub({ amount: 9.95, status: "trial" }),
      sub({ amount: 15, status: "cancelled" }),
      sub({ amount: 40, dismissed: true }),
      sub({ amount: 11, status: "cancellation_pending" }),
    ]);
    expect(t.monthlySubscriptions).toBeCloseTo(12 + 10 + 11);
    expect(t.monthlyBills).toBe(1150);
    expect(t.monthly).toBeCloseTo(1183);
    expect(t.yearly).toBeCloseTo(1183 * 12);
    expect(t.trialCount).toBe(1);
    expect(t.trialMonthlyIfKept).toBeCloseTo(9.95);
    expect(t.pendingCount).toBe(1);
    expect(t.cancelledYearlySavings).toBe(180);
  });
});

describe("renewalsWithin", () => {
  it("includes renewals and trial conversions inside the window, soonest first", () => {
    const items = renewalsWithin(
      [
        sub({ name: "B", next_payment_date: "2026-11-20" }),
        sub({ name: "A", next_payment_date: "2026-11-12" }),
        sub({ name: "Far", next_payment_date: "2027-01-20" }),
        sub({ name: "Trial", status: "trial", trial_ends_at: "2026-11-14", next_payment_date: "2026-11-14" }),
        sub({ name: "Gone", status: "cancelled", next_payment_date: "2026-11-15" }),
        sub({ name: "Past", next_payment_date: "2026-11-01" }),
      ],
      30,
      today,
    );
    expect(items.map((i) => i.subscription.name)).toEqual(["A", "Trial", "B"]);
    expect(items[1].kind).toBe("trial_conversion");
    expect(items[0].daysAway).toBe(3);
  });
});

describe("latestPriceChange", () => {
  it("finds the most recent change in charge history", () => {
    const change = latestPriceChange([
      { id: "1", booked_at: "2026-06-07", amount: -13.99 },
      { id: "2", booked_at: "2026-07-07", amount: -13.99 },
      { id: "3", booked_at: "2026-08-07", amount: -15.99 },
      { id: "4", booked_at: "2026-09-07", amount: -15.99 },
    ]);
    expect(change).toEqual({ from: 13.99, to: 15.99, date: "2026-08-07" });
  });

  it("returns null for stable prices", () => {
    expect(latestPriceChange([{ id: "1", booked_at: "2026-06-07", amount: -9 }, { id: "2", booked_at: "2026-07-07", amount: -9 }])).toBeNull();
  });
});

describe("possiblyForgotten", () => {
  it("flags long-running, unreviewed services without recent email", () => {
    expect(possiblyForgotten(sub({ last_reviewed_at: null }), today)).toBe(true);
    expect(possiblyForgotten(sub({ last_reviewed_at: null, last_email_at: "2026-10-30T00:00:00Z" }), today)).toBe(false);
    expect(possiblyForgotten(sub({ last_reviewed_at: "2026-10-30T00:00:00Z" }), today)).toBe(false);
    expect(possiblyForgotten(sub({ last_reviewed_at: null, started_at: "2026-10-01" }), today)).toBe(false);
    expect(possiblyForgotten(sub({ last_reviewed_at: null, category_id: "bills" }), today)).toBe(false);
  });
});

describe("computeAttention", () => {
  it("raises the expected flags, critical first", () => {
    const spotify = sub({ id: "s", name: "Spotify", merchant_key: "spotify" });
    const deezer = sub({ id: "d", name: "Deezer", merchant_key: "deezer" });
    const netflix = sub({ id: "n", name: "Netflix", merchant_key: "netflix", amount: 15.99 });
    const streamz = sub({ id: "z", name: "Streamz", merchant_key: "streamz", status: "cancelled", cancellation_confirmed_at: "2026-09-10T00:00:00Z" });
    const audible = sub({ id: "a", name: "Audible", merchant_key: "audible", status: "trial", trial_ends_at: "2026-11-11", amount: 9.95 });
    const disney = sub({ id: "p", name: "Disney+", merchant_key: "disney-plus", status: "cancellation_pending", cancellation_requested_at: "2026-11-07T00:00:00Z" });
    const fresh = sub({ id: "f", name: "New thing", merchant_key: "new-thing", user_confirmed: false, detection_source: "bank" });
    const items = computeAttention([spotify, deezer, netflix, streamz, audible, disney, fresh], {
      today,
      chargesBySubscription: new Map([
        ["n", [{ id: "1", booked_at: "2026-08-07", amount: -13.99 }, { id: "2", booked_at: "2026-09-07", amount: -15.99 }]],
      ]),
      chargesAfterCancel: new Map([["z", [{ id: "x", booked_at: "2026-10-22", amount: -12.99 }]]]),
      cancellationEmails: new Map([["disney-plus", [{ id: "e", received_at: "2026-11-08T08:00:00Z" }]]]),
    });
    const kinds = items.map((i) => i.kind);
    expect(kinds[0]).toBe("charged_after_cancel");
    expect(kinds).toContain("trial_ending");
    expect(kinds).toContain("price_increase");
    expect(kinds).toContain("duplicate");
    expect(kinds).toContain("review");
    const pending = items.find((i) => i.kind === "cancellation_pending")!;
    expect(pending.title).toMatch(/cancellation email arrived/);
    const trial = items.find((i) => i.kind === "trial_ending")!;
    expect(trial.severity).toBe("critical");
  });
});

describe("cancelSteps and timeline", () => {
  it("falls back to generic steps", () => {
    expect(cancelSteps({ cancel_instructions: null })).toEqual(GENERIC_CANCEL_STEPS);
    expect(cancelSteps({ cancel_instructions: "One\n\nTwo" })).toEqual(["One", "Two"]);
  });

  it("orders timeline entries and marks future ones", () => {
    const t = buildTimeline(sub({ status: "cancellation_pending", cancellation_requested_at: "2026-11-07T00:00:00Z" }), { today });
    const labels = t.map((e) => e.label);
    expect(labels[0]).toBe("First charge");
    expect(labels).toContain("Cancellation requested");
    expect(t.find((e) => e.label === "Next payment")?.future).toBe(true);
  });
});
