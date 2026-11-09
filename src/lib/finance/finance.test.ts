import { describe, expect, it } from "vitest";
import { classifyTransaction, pairInternalTransfers } from "./categorize";
import { normaliseMerchant } from "./merchants";
import { detectRecurring, findSimilarServices, monthlyEquivalent } from "./recurring";

describe("normaliseMerchant", () => {
  it("recognises Belgian statement lines", () => {
    expect(normaliseMerchant("BETALING MET DEBETKAART 08/11 14:32 COLRUYT GENT 1234").key).toBe("colruyt");
    expect(normaliseMerchant("Paiement Bancontact DELHAIZE IXELLES").name).toBe("Delhaize");
    expect(normaliseMerchant("NETFLIX.COM 866-579-7172").key).toBe("netflix");
    expect(normaliseMerchant("AMAZON PRIME*2K4L9 AMZN.DE").key).toBe("amazon-prime");
    expect(normaliseMerchant("AMZN Mktp DE*AB12C").key).toBe("amazon");
  });

  it("cleans unknown merchants into a readable name", () => {
    const m = normaliseMerchant("BETALING MET DEBETKAART 12/10 BAKKERIJ VAN DAMME LEUVEN 556677");
    expect(m.name).toBe("Bakkerij Van Damme");
    expect(m.key).toBe("bakkerij-van-damme");
  });
});

describe("classifyTransaction", () => {
  it("never treats own-account transfers as spending", () => {
    const own = new Set(["abc"]);
    expect(classifyTransaction({ amount: -500, description: "Overschrijving", counterpartyIbanHash: "abc" }, { ownIbanHashes: own }).kind).toBe("transfer");
    expect(classifyTransaction({ amount: -200, description: "Naar mijn spaarrekening" }).kind).toBe("transfer");
  });

  it("categorises common expenses, income and refunds", () => {
    expect(classifyTransaction({ amount: -54.2, description: "COLRUYT LEUVEN" }).categoryId).toBe("groceries");
    expect(classifyTransaction({ amount: -23.5, description: "UBER *EATS" }).categoryId).toBe("restaurants");
    const salary = classifyTransaction({ amount: 3450, counterpartyName: "ACME BV", description: "Loon oktober" });
    expect([salary.kind, salary.categoryId]).toEqual(["income", "salary"]);
    const refund = classifyTransaction({ amount: 39.99, description: "ZALANDO terugbetaling" });
    expect([refund.kind, refund.categoryId]).toEqual(["refund", "shopping"]);
    const cash = classifyTransaction({ amount: -60, description: "GELDOPNEMING BANCONTACT" });
    expect([cash.kind, cash.categoryId]).toEqual(["withdrawal", "cash"]);
    expect(classifyTransaction({ amount: -1150, counterpartyName: "J. Peeters", description: "Huur november" }).categoryId).toBe("housing");
  });

  it("treats tax refunds as income and hospitalisation insurance as a bill", () => {
    const tax = classifyTransaction({ amount: 1250, description: "Belastingterugbetaling FOD Financien" });
    expect([tax.kind, tax.categoryId]).toEqual(["income", "other_income"]);
    const dkv = classifyTransaction({ amount: -24.5, description: "DKV Belgium hospitalisatieverzekering" });
    expect([dkv.merchantKey, dkv.categoryId]).toEqual(["insurance", "bills"]);
  });

  it("uses shop-type keywords for merchants outside the catalogue", () => {
    const bakery = classifyTransaction({ amount: -8.4, description: "BETALING MET DEBETKAART BAKKERIJ VAN DAMME LEUVEN" });
    expect([bakery.merchant, bakery.categoryId]).toEqual(["Bakkerij Van Damme", "groceries"]);
    expect(classifyTransaction({ amount: -64, description: "BRASSERIE DE MARKT LEUVEN" }).categoryId).toBe("restaurants");
  });

  it("applies user rules before automatic rules", () => {
    const c = classifyTransaction({ amount: -12, description: "BAKKERIJ VAN DAMME" }, { rules: [{ pattern: "van damme", category_id: "business" }] });
    expect([c.categoryId, c.categorySource]).toEqual(["business", "rule"]);
  });
});

describe("pairInternalTransfers", () => {
  it("pairs equal and opposite amounts across own accounts", () => {
    const ids = pairInternalTransfers([
      { id: "a", account_id: "checking", booked_at: "2026-10-01", amount: -500, kind: "expense" },
      { id: "b", account_id: "savings", booked_at: "2026-10-02", amount: 500, kind: "income" },
      { id: "c", account_id: "checking", booked_at: "2026-10-02", amount: -500, kind: "expense" },
    ]);
    expect(ids.sort()).toEqual(["a", "b"]);
  });
});

describe("detectRecurring", () => {
  const today = new Date(2026, 10, 9);
  const monthly = (key: string, amounts: number[], day = 5, category = "subscriptions") =>
    amounts.map((a, i) => ({
      id: `${key}-${i}`,
      booked_at: `2026-${String(6 + i).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      amount: -a,
      kind: "expense" as const,
      merchant: key,
      merchant_key: key,
      category_id: category,
    }));

  it("detects a monthly subscription and its next date", () => {
    const [c] = detectRecurring(monthly("netflix", [15.99, 15.99, 15.99, 15.99, 15.99]), today);
    expect(c.cycle).toBe("monthly");
    expect(c.nextDate).toBe("2026-11-05");
    expect(c.amount).toBe(15.99);
    expect(c.priceIncrease).toBe(false);
  });

  it("flags a price increase", () => {
    const [c] = detectRecurring(monthly("spotify", [11.99, 11.99, 11.99, 11.99, 12.99]), today);
    expect(c.priceIncrease).toBe(true);
    expect(c.previousAmount).toBe(11.99);
  });

  it("remembers a price change that happened a few charges ago", () => {
    const [c] = detectRecurring(monthly("netflix", [13.99, 13.99, 15.99, 15.99, 15.99]), today);
    expect([c.previousAmount, c.priceChangedAt, c.priceIncrease]).toEqual([13.99, "2026-08-05", true]);
  });

  it("ignores everyday shopping at the same supermarket", () => {
    expect(detectRecurring(monthly("colruyt", [40, 52, 38, 61, 45], 5, "groceries"), today)).toHaveLength(0);
  });

  it("drops subscriptions that stopped charging", () => {
    const old = monthly("deezer", [10.99, 10.99, 10.99]).map((t, i) => ({ ...t, booked_at: `2026-0${1 + i}-10` }));
    expect(detectRecurring(old, today)).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("computes monthly equivalents", () => {
    expect(monthlyEquivalent(120, "yearly")).toBe(10);
    expect(monthlyEquivalent(30, "quarterly")).toBe(10);
  });

  it("finds similar services", () => {
    const groups = findSimilarServices([
      { id: "1", name: "Spotify", merchant_key: "spotify", status: "active", amount: 12, billing_cycle: "monthly" },
      { id: "2", name: "Deezer", merchant_key: "deezer", status: "active", amount: 11, billing_cycle: "monthly" },
      { id: "3", name: "Netflix", merchant_key: "netflix", status: "cancelled", amount: 16, billing_cycle: "monthly" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe("music_streaming");
  });
});
