import { beforeEach, describe, expect, it } from "vitest";
import { __resetForTests, LOCAL_USER_ID, localDb } from "./db";

const U = LOCAL_USER_ID;
const tx = (id: string, booked_at: string, amount: number, extra: Record<string, unknown> = {}) => ({
  user_id: U,
  source: "csv",
  external_id: id,
  booked_at,
  amount,
  kind: amount < 0 ? "expense" : "income",
  merchant: `M${id}`,
  merchant_key: `m${id}`,
  category_id: amount < 0 ? "groceries" : "salary",
  ...extra,
});

beforeEach(() => __resetForTests());

describe("local database (supabase-js compatible subset)", () => {
  it("seeds system categories and the local profile", async () => {
    const { data: cats } = await localDb.from("categories").select("*").order("sort_order");
    expect((cats as unknown[]).length).toBe(17);
    const { data: profile } = await localDb.from("profiles").select("*").eq("id", U).maybeSingle();
    expect(profile).toMatchObject({ base_currency: "EUR", ai_assistant_enabled: false });
  });

  it("applies column defaults and returns inserted rows", async () => {
    const { data, error } = await localDb.from("subscriptions").insert({ user_id: U, name: "Netflix", merchant_key: "netflix" }).select("id, status, dismissed, charge_count").single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "active", dismissed: false, charge_count: 0 });
  });

  it("filters, orders, ranges and counts", async () => {
    await localDb.from("transactions").insert([tx("1", "2026-11-01", -10), tx("2", "2026-11-03", -30), tx("3", "2026-10-20", 2000), tx("4", "2026-11-05", -5, { kind: "transfer" })]);
    const res = await localDb.from("transactions").select("*", { count: "exact" }).gte("booked_at", "2026-11-01").neq("kind", "transfer").order("booked_at", { ascending: false }).range(0, 0);
    expect(res.count).toBe(2);
    expect((res.data as { external_id: string }[]).map((r) => r.external_id)).toEqual(["2"]);
    const head = await localDb.from("transactions").select("id", { count: "exact", head: true }).lt("amount", 0);
    expect([head.count, head.data]).toEqual([3, null]);
    const big = await localDb.from("transactions").select("external_id").or(`amount.gte.100,amount.lte.-20`);
    expect((big.data as unknown[]).length).toBe(2);
    const search = await localDb.from("transactions").select("external_id").or("merchant.ilike.%m2%,notes.ilike.%m2%");
    expect(search.data).toEqual([{ external_id: "2" }]);
    const inList = await localDb.from("transactions").select("external_id").in("kind", ["income", "transfer"]).not("merchant_key", "is", null);
    expect((inList.data as unknown[]).length).toBe(2);
  });

  it("upserts on a conflict key, optionally ignoring duplicates", async () => {
    await localDb.from("transactions").upsert([tx("a", "2026-11-01", -10)], { onConflict: "user_id,source,external_id" });
    const second = await localDb.from("transactions").upsert([tx("a", "2026-11-01", -99), tx("b", "2026-11-02", -1)], { onConflict: "user_id,source,external_id", ignoreDuplicates: true }).select("id");
    expect((second.data as unknown[]).length).toBe(1);
    const { data } = await localDb.from("transactions").select("amount").eq("external_id", "a").single();
    expect(data).toEqual({ amount: -10 });
    await localDb.from("transactions").upsert(tx("a", "2026-11-01", -12), { onConflict: "user_id,source,external_id" });
    expect((await localDb.from("transactions").select("amount").eq("external_id", "a").single()).data).toEqual({ amount: -12 });
  });

  it("rejects duplicate inserts on unique keys", async () => {
    await localDb.from("budgets").insert({ user_id: U, category_id: "groceries", amount: 100 });
    const { error } = await localDb.from("budgets").insert({ user_id: U, category_id: "groceries", amount: 200 });
    expect(error?.code).toBe("23505");
  });

  it("updates and deletes with counts, cascading foreign keys", async () => {
    const { data: acc } = await localDb.from("accounts").insert({ user_id: U, source: "csv", external_id: "x", name: "A" }).select("id").single();
    const accId = (acc as { id: string }).id;
    await localDb.from("transactions").insert([tx("1", "2026-11-01", -1, { account_id: accId }), tx("2", "2026-11-01", -2)]);
    const upd = await localDb.from("transactions").update({ notes: "hi" }, { count: "exact" }).eq("account_id", accId);
    expect(upd.count).toBe(1);
    const del = await localDb.from("accounts").delete({ count: "exact" }).eq("id", accId).in("source", ["csv", "manual"]);
    expect(del.count).toBe(1);
    expect(((await localDb.from("transactions").select("external_id")).data as unknown[]).length).toBe(1);
  });

  it("implements the analytics SQL functions", async () => {
    await localDb.from("transactions").insert([
      tx("1", "2026-11-02", -40),
      tx("2", "2026-11-04", -10, { category_id: "restaurants" }),
      tx("3", "2026-11-05", 5, { kind: "refund", category_id: "groceries" }),
      tx("4", "2026-11-06", 3000),
      tx("5", "2026-11-06", -500, { kind: "transfer", category_id: "transfers" }),
    ]);
    const month = await localDb.rpc("spending_by_period", { p_from: "2026-11-01", p_to: "2026-11-30", p_grain: "month" });
    expect(month.data).toEqual([{ period: "2026-11-01", spent: 45, income: 3000, refunds: 5, tx_count: 4 }]);
    await localDb.from("transactions").insert(tx("sun", "2026-11-01", -1)); // a Sunday belongs to the week of Mon 26 Oct
    const week = await localDb.rpc("spending_by_period", { p_from: "2026-11-01", p_to: "2026-11-30", p_grain: "week" });
    expect((week.data as { period: string }[]).map((w) => w.period)).toEqual(["2026-10-26", "2026-11-02"]);
    const cats = await localDb.rpc("spending_by_category", { p_from: "2026-11-02", p_to: "2026-11-30" });
    expect(cats.data).toEqual([
      { category_id: "groceries", spent: 35, tx_count: 2 },
      { category_id: "restaurants", spent: 10, tx_count: 1 },
    ]);
  });
});
