// Action logic shared by the server edition ("use server" wrappers in src/app/actions)
// and the GitHub Pages edition (runs in the browser against the local store).
import { revalidatePath } from "@/lib/revalidate";
import { z } from "zod";
import { requireUser, type AppSupabaseClient } from "@/lib/supabase/server";
import { classifyTransaction, type CategoryRule } from "@/lib/finance/categorize";
import { analyseCsv, looksLikeIban, type CsvMapping } from "@/lib/finance/csv";
import { slugify } from "@/lib/finance/merchants";
import { hashIdentifier } from "@/lib/crypto";
import { maskIban } from "@/lib/format";
import { runPipeline } from "@/lib/engines/pipeline";
import type { Category, TransactionKind } from "@/lib/types";

type Result<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; message: string };

function refresh() {
  revalidatePath("/", "layout");
}

async function loadRulesAndCategories(supabase: AppSupabaseClient) {
  const [rules, cats, accounts] = await Promise.all([
    supabase.from("category_rules").select("pattern, category_id"),
    supabase.from("categories").select("id, kind"),
    supabase.from("accounts").select("iban_hash"),
  ]);
  const categories = (cats.data ?? []) as Pick<Category, "id" | "kind">[];
  return {
    rules: (rules.data ?? []) as CategoryRule[],
    incomeCategories: new Set(categories.filter((c) => c.kind === "income").map((c) => c.id)),
    categoryKinds: new Map(categories.map((c) => [c.id, c.kind])),
    ownIbanHashes: new Set(((accounts.data ?? []) as { iban_hash: string | null }[]).map((a) => a.iban_hash).filter((h): h is string => Boolean(h))),
  };
}

function kindFor(amount: number, categoryKind: Category["kind"] | undefined, categoryId: string): TransactionKind {
  if (categoryKind === "transfer") return "transfer";
  if (categoryId === "cash" && amount < 0) return "withdrawal";
  if (amount > 0) return categoryKind === "income" ? "income" : "refund";
  return "expense";
}

// ------------------------------------------------------------------ editing

const categoryInput = z.object({ id: z.uuid(), categoryId: z.string().min(1).max(64), applyToSimilar: z.boolean().default(false) });

export async function updateTransactionCategory(input: z.input<typeof categoryInput>): Promise<Result<{ updatedSimilar: number }>> {
  const parsed = categoryInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const { supabase, user } = await requireUser();
  const { id, categoryId, applyToSimilar } = parsed.data;
  const { data: tx } = await supabase.from("transactions").select("id, amount, merchant, merchant_key").eq("id", id).maybeSingle();
  const { data: cat } = await supabase.from("categories").select("id, kind").eq("id", categoryId).maybeSingle();
  if (!tx || !cat) return { ok: false, message: "Not found" };

  const { error } = await supabase
    .from("transactions")
    .update({ category_id: categoryId, category_source: "user", kind: kindFor(Number(tx.amount), cat.kind as Category["kind"], categoryId) })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  let updatedSimilar = 0;
  if (applyToSimilar && tx.merchant_key && tx.merchant) {
    await supabase.from("category_rules").upsert({ user_id: user.id, pattern: tx.merchant.toLowerCase().slice(0, 120), category_id: categoryId }, { onConflict: "user_id,pattern" });
    const { data: similar } = await supabase.from("transactions").select("id, amount").eq("merchant_key", tx.merchant_key).neq("category_source", "user").neq("id", id);
    for (const s of (similar ?? []) as { id: string; amount: number }[]) {
      await supabase
        .from("transactions")
        .update({ category_id: categoryId, category_source: "rule", kind: kindFor(Number(s.amount), cat.kind as Category["kind"], categoryId) })
        .eq("id", s.id);
      updatedSimilar++;
    }
  }
  refresh();
  return { ok: true, data: { updatedSimilar } };
}

const txUpdate = z.object({ id: z.uuid(), notes: z.string().max(1000).nullable().optional(), isTransfer: z.boolean().optional() });

export async function updateTransactionDetails(input: z.input<typeof txUpdate>): Promise<Result> {
  const parsed = txUpdate.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const { supabase } = await requireUser();
  const { id, notes, isTransfer } = parsed.data;
  const patch: Record<string, unknown> = {};
  if (notes !== undefined) patch.notes = notes?.trim() || null;
  if (isTransfer !== undefined) {
    const { data: tx } = await supabase.from("transactions").select("amount, description, counterparty_name").eq("id", id).maybeSingle();
    if (!tx) return { ok: false, message: "Not found" };
    if (isTransfer) Object.assign(patch, { kind: "transfer", category_id: "transfers", category_source: "user" });
    else {
      const c = classifyTransaction({ amount: Number(tx.amount), description: tx.description, counterpartyName: tx.counterparty_name });
      const fallback = c.kind === "transfer" ? (Number(tx.amount) > 0 ? "income" : "expense") : c.kind;
      Object.assign(patch, { kind: fallback, category_id: c.categoryId === "transfers" ? (Number(tx.amount) > 0 ? "other_income" : "other") : c.categoryId, category_source: "user" });
    }
  }
  const { error } = await supabase.from("transactions").update(patch).eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

async function manualAccountId(supabase: AppSupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase
    .from("accounts")
    .upsert({ user_id: userId, source: "manual", external_id: "manual", name: "Manual entries", type: "cash", include_in_totals: false }, { onConflict: "user_id,source,external_id" })
    .select("id")
    .single();
  return data!.id as string;
}

const manualTx = z.object({
  date: z.iso.date(),
  amount: z.number().positive().max(10_000_000),
  direction: z.enum(["out", "in"]),
  description: z.string().trim().min(1).max(200),
  categoryId: z.string().min(1).max(64).optional(),
  notes: z.string().max(1000).optional(),
});

export async function addManualTransaction(input: z.input<typeof manualTx>): Promise<Result> {
  const parsed = manualTx.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { supabase, user } = await requireUser();
  const d = parsed.data;
  const amount = d.direction === "out" ? -d.amount : d.amount;
  const ctx = await loadRulesAndCategories(supabase);
  const c = classifyTransaction({ amount, description: d.description }, ctx);
  const categoryId = d.categoryId ?? c.categoryId;
  const { error } = await supabase.from("transactions").insert({
    user_id: user.id,
    account_id: await manualAccountId(supabase, user.id),
    source: "manual",
    external_id: globalThis.crypto.randomUUID(),
    booked_at: d.date,
    amount,
    description: d.description,
    merchant: c.merchant,
    merchant_key: c.merchantKey,
    kind: d.categoryId ? kindFor(amount, ctx.categoryKinds.get(categoryId), categoryId) : c.kind,
    category_id: categoryId,
    category_source: d.categoryId ? "user" : c.categorySource,
    notes: d.notes?.trim() || null,
  });
  if (error) return { ok: false, message: error.message };
  await runPipeline(supabase, user.id);
  refresh();
  return { ok: true, message: "Transaction added" };
}

export async function deleteTransaction(id: string): Promise<Result> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Invalid id" };
  const { supabase } = await requireUser();
  const { error, count } = await supabase.from("transactions").delete({ count: "exact" }).eq("id", id).in("source", ["manual", "csv"]);
  if (error) return { ok: false, message: error.message };
  if (!count) return { ok: false, message: "Only manually added or imported transactions can be deleted. Bank transactions mirror your bank." };
  refresh();
  return { ok: true };
}

// --------------------------------------------------------------- CSV import

const MAX_CSV_BYTES = 5 * 1024 * 1024;

export interface CsvPreview {
  delimiter: string;
  headers: string[];
  mapping: CsvMapping;
  totalRows: number;
  validRows: number;
  sample: { date: string; amount: number; description: string; counterparty: string | null }[];
  errors: { line: number; message: string }[];
  dateRange: { from: string; to: string } | null;
  detectedAccount: string | null;
}

const mappingSchema = z.partialRecord(z.enum(["date", "amount", "debit", "credit", "description", "counterparty", "counterpartyAccount", "currency", "account"]), z.number().int().min(0).max(200)).optional();

export async function previewCsvImport(text: string, mapping?: CsvMapping): Promise<Result<CsvPreview>> {
  await requireUser();
  if (typeof text !== "string" || text.length === 0) return { ok: false, message: "The file is empty" };
  if (text.length > MAX_CSV_BYTES) return { ok: false, message: "File is larger than 5 MB" };
  const m = mappingSchema.safeParse(mapping);
  const a = analyseCsv(text, m.success ? m.data : undefined);
  if (a.mapping.date === undefined || (a.mapping.amount === undefined && a.mapping.debit === undefined && a.mapping.credit === undefined)) {
    return {
      ok: true,
      data: { delimiter: a.delimiter, headers: a.headers, mapping: a.mapping, totalRows: a.totalLines, validRows: 0, sample: [], errors: [{ line: 1, message: "Couldn't find a date and amount column - choose them below." }], dateRange: null, detectedAccount: null },
    };
  }
  const dates = a.rows.map((r) => r.date).sort();
  const accountValues = a.rows.map((r) => r.account).filter((v): v is string => Boolean(v));
  return {
    ok: true,
    data: {
      delimiter: a.delimiter,
      headers: a.headers,
      mapping: a.mapping,
      totalRows: a.totalLines,
      validRows: a.rows.length,
      sample: a.rows.slice(0, 8).map((r) => ({ date: r.date, amount: r.amount, description: r.description, counterparty: r.counterparty })),
      errors: a.errors.slice(0, 5),
      dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      detectedAccount: accountValues[0] && looksLikeIban(accountValues[0]) ? maskIban(accountValues[0]) : null,
    },
  };
}

const importInput = z.object({ text: z.string().min(1).max(MAX_CSV_BYTES), mapping: mappingSchema, accountName: z.string().trim().min(1).max(80) });

export async function importCsv(input: z.input<typeof importInput>): Promise<Result<{ imported: number; skipped: number; subscriptions: number }>> {
  const parsed = importInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid import request" };
  const { supabase, user } = await requireUser();
  const a = analyseCsv(parsed.data.text, parsed.data.mapping);
  if (a.rows.length === 0) return { ok: false, message: "No valid rows found in the file" };
  if (a.rows.length > 20_000) return { ok: false, message: "Import up to 20,000 rows at a time" };

  const ownIban = a.rows.map((r) => r.account).find((v) => looksLikeIban(v));
  const { data: account, error: accErr } = await supabase
    .from("accounts")
    .upsert(
      {
        user_id: user.id,
        source: "csv",
        external_id: ownIban ? hashIdentifier(ownIban) : slugify(parsed.data.accountName) || "csv",
        name: parsed.data.accountName,
        iban_masked: ownIban ? maskIban(ownIban) : null,
        iban_hash: ownIban ? hashIdentifier(ownIban) : null,
        type: "checking",
        include_in_totals: false,
      },
      { onConflict: "user_id,source,external_id" },
    )
    .select("id")
    .single();
  if (accErr || !account) return { ok: false, message: accErr?.message ?? "Could not create the account" };

  const ctx = await loadRulesAndCategories(supabase);
  if (ownIban) ctx.ownIbanHashes.add(hashIdentifier(ownIban));
  const rows = a.rows.map((r) => {
    const cpHash = r.counterpartyAccount && looksLikeIban(r.counterpartyAccount) ? hashIdentifier(r.counterpartyAccount) : null;
    const c = classifyTransaction({ amount: r.amount, description: r.description, counterpartyName: r.counterparty, counterpartyIbanHash: cpHash }, ctx);
    return {
      user_id: user.id,
      account_id: account.id,
      source: "csv",
      external_id: r.externalId,
      booked_at: r.date,
      amount: r.amount,
      currency: r.currency,
      description: r.description,
      merchant: c.merchant,
      merchant_key: c.merchantKey,
      counterparty_name: r.counterparty,
      counterparty_iban_masked: r.counterpartyAccount && looksLikeIban(r.counterpartyAccount) ? maskIban(r.counterpartyAccount) : null,
      counterparty_iban_hash: cpHash,
      kind: c.kind,
      category_id: c.categoryId,
      category_source: c.categorySource,
    };
  });

  let imported = 0;
  for (let i = 0; i < rows.length; i += 500) {
    // ignoreDuplicates keeps any edits you made to previously imported rows.
    const { data, error } = await supabase.from("transactions").upsert(rows.slice(i, i + 500), { onConflict: "user_id,source,external_id", ignoreDuplicates: true }).select("id");
    if (error) return { ok: false, message: `Import failed: ${error.message}` };
    imported += data?.length ?? 0;
  }
  const pipeline = await runPipeline(supabase, user.id);
  await supabase.rpc("log_audit", { p_action: "import.csv", p_details: { rows: rows.length, imported } });
  refresh();
  return { ok: true, data: { imported, skipped: rows.length - imported, subscriptions: pipeline.subscriptionsCreated } };
}

// ------------------------------------------------------- categories & rules

const newCategory = z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(["expense", "income"]), icon: z.string().max(40).default("tag") });

export async function createCategory(input: z.input<typeof newCategory>): Promise<Result<{ id: string }>> {
  const parsed = newCategory.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("categories")
    .insert({ user_id: user.id, name: parsed.data.name, kind: parsed.data.kind, icon: parsed.data.icon, sort_order: 500 })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, data: { id: data.id as string } };
}

export async function deleteCategory(id: string): Promise<Result> {
  const { supabase } = await requireUser();
  // Move its transactions to "Other" first so nothing disappears from totals.
  await supabase.from("transactions").update({ category_id: "other", category_source: "auto" }).eq("category_id", id);
  const { error, count } = await supabase.from("categories").delete({ count: "exact" }).eq("id", id).eq("is_system", false);
  if (error) return { ok: false, message: error.message };
  if (!count) return { ok: false, message: "System categories can't be deleted" };
  refresh();
  return { ok: true };
}

export async function deleteCategoryRule(id: string): Promise<Result> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Invalid id" };
  const { supabase } = await requireUser();
  await supabase.from("category_rules").delete().eq("id", id);
  refresh();
  return { ok: true };
}

const ruleInput = z.object({ pattern: z.string().trim().min(2).max(120), categoryId: z.string().min(1).max(64), applyNow: z.boolean().default(true) });

export async function createCategoryRule(input: z.input<typeof ruleInput>): Promise<Result<{ updated: number }>> {
  const parsed = ruleInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { supabase, user } = await requireUser();
  const { pattern, categoryId, applyNow } = parsed.data;
  const { data: cat } = await supabase.from("categories").select("kind").eq("id", categoryId).maybeSingle();
  if (!cat) return { ok: false, message: "Unknown category" };
  const { error } = await supabase.from("category_rules").upsert({ user_id: user.id, pattern: pattern.toLowerCase(), category_id: categoryId }, { onConflict: "user_id,pattern" });
  if (error) return { ok: false, message: error.message };
  let updated = 0;
  if (applyNow) {
    const term = pattern.replace(/[%,()]/g, " ").trim();
    const { data: matches } = await supabase
      .from("transactions")
      .select("id, amount")
      .neq("category_source", "user")
      .or(`merchant.ilike.%${term}%,description.ilike.%${term}%,counterparty_name.ilike.%${term}%`);
    for (const t of (matches ?? []) as { id: string; amount: number }[]) {
      await supabase.from("transactions").update({ category_id: categoryId, category_source: "rule", kind: kindFor(Number(t.amount), cat.kind as Category["kind"], categoryId) }).eq("id", t.id);
      updated++;
    }
  }
  refresh();
  return { ok: true, data: { updated } };
}

// ------------------------------------------------------------------ budgets

const budgetInput = z.object({ categoryId: z.string().min(1).max(64), amount: z.number().positive().max(1_000_000) });

export async function saveBudget(input: z.input<typeof budgetInput>): Promise<Result> {
  const parsed = budgetInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("budgets").upsert({ user_id: user.id, category_id: parsed.data.categoryId, amount: parsed.data.amount }, { onConflict: "user_id,category_id" });
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

export async function deleteBudget(id: string): Promise<Result> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Invalid id" };
  const { supabase } = await requireUser();
  await supabase.from("budgets").delete().eq("id", id);
  refresh();
  return { ok: true };
}

export async function deleteAccount(id: string): Promise<Result> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Invalid id" };
  const { supabase } = await requireUser();
  const { error, count } = await supabase.from("accounts").delete({ count: "exact" }).eq("id", id).in("source", ["csv", "manual"]);
  if (error) return { ok: false, message: error.message };
  if (!count) return { ok: false, message: "Bank accounts are removed by disconnecting the bank" };
  refresh();
  return { ok: true };
}
