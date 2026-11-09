/**
 * Table definitions for the in-browser store used by the GitHub Pages
 * edition. Mirrors supabase/migrations: column defaults, unique keys and
 * foreign-key behaviour (cascade / set null).
 */

export type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const uuid = () => globalThis.crypto.randomUUID();

type DefaultValue = unknown | (() => unknown);

export interface TableDef {
  defaults: Record<string, DefaultValue>;
  unique: string[][]; // first entry = primary key
  touchUpdatedAt?: boolean;
}

const base = { id: uuid, created_at: now };

export const TABLES: Record<string, TableDef> = {
  profiles: {
    defaults: {
      display_name: null,
      base_currency: "EUR",
      locale: "en-BE",
      timezone: "Europe/Brussels",
      theme: "dark",
      ai_assistant_enabled: false,
      ai_email_extraction_enabled: false,
      notification_prefs: () => ({}),
      email_retention_days: 730,
      large_purchase_threshold: 150,
      onboarded_at: null,
      created_at: now,
      updated_at: now,
    },
    unique: [["id"]],
    touchUpdatedAt: true,
  },
  categories: {
    defaults: { id: uuid, user_id: null, kind: "expense", icon: "circle", is_system: false, sort_order: 100, created_at: now },
    unique: [["id"]],
  },
  category_rules: { defaults: { ...base }, unique: [["id"], ["user_id", "pattern"]] },
  connections: {
    defaults: { ...base, scopes: () => [], status: "active", consent_expires_at: null, last_synced_at: null, last_error: null, sync_state: () => ({}), metadata: () => ({}), updated_at: now },
    unique: [["id"], ["user_id", "provider", "label"]],
    touchUpdatedAt: true,
  },
  connection_secrets: { defaults: { updated_at: now }, unique: [["connection_id"]] },
  sync_runs: { defaults: { id: uuid, status: "running", stats: () => ({}), error: null, started_at: now, finished_at: null }, unique: [["id"]] },
  accounts: {
    defaults: {
      ...base,
      connection_id: null,
      institution: null,
      iban_masked: null,
      iban_hash: null,
      currency: "EUR",
      type: "checking",
      balance: null,
      balance_updated_at: null,
      include_in_totals: true,
      is_demo: false,
      updated_at: now,
    },
    unique: [["id"], ["user_id", "source", "external_id"]],
    touchUpdatedAt: true,
  },
  subscriptions: {
    defaults: {
      ...base,
      provider: null,
      category_id: "subscriptions",
      amount: null,
      currency: "EUR",
      billing_cycle: "monthly",
      status: "active",
      next_payment_date: null,
      last_payment_date: null,
      last_payment_amount: null,
      previous_amount: null,
      price_changed_at: null,
      started_at: null,
      trial_ends_at: null,
      payment_method: null,
      cancel_url: null,
      cancel_instructions: null,
      cancellation_deadline: null,
      cancellation_requested_at: null,
      cancellation_confirmed_at: null,
      cancellation_reference: null,
      detection_source: "manual",
      detection_confidence: null,
      charge_count: 0,
      last_email_at: null,
      user_confirmed: false,
      dismissed: false,
      last_reviewed_at: null,
      notes: null,
      is_demo: false,
      updated_at: now,
    },
    unique: [["id"], ["user_id", "merchant_key", "billing_cycle"]],
    touchUpdatedAt: true,
  },
  transactions: {
    defaults: {
      ...base,
      account_id: null,
      value_date: null,
      currency: "EUR",
      description: null,
      merchant: null,
      merchant_key: null,
      counterparty_name: null,
      counterparty_iban_masked: null,
      counterparty_iban_hash: null,
      mcc: null,
      kind: "expense",
      category_id: null,
      category_source: "auto",
      subscription_id: null,
      status: "booked",
      notes: null,
      is_demo: false,
      updated_at: now,
    },
    unique: [["id"], ["user_id", "source", "external_id"]],
    touchUpdatedAt: true,
  },
  budgets: { defaults: { ...base }, unique: [["id"], ["user_id", "category_id"]] },
  emails: {
    defaults: {
      ...base,
      connection_id: null,
      provider: "gmail",
      thread_id: null,
      from_name: null,
      from_email: null,
      subject: null,
      snippet: null,
      category: "other",
      is_important: false,
      merchant: null,
      merchant_key: null,
      amount: null,
      currency: null,
      order_number: null,
      due_date: null,
      event_start: null,
      event_end: null,
      location: null,
      extracted: () => ({}),
      extraction_method: "rules",
      web_link: null,
      is_demo: false,
    },
    unique: [["id"], ["user_id", "provider", "external_id"]],
  },
  events: {
    defaults: {
      ...base,
      external_id: uuid,
      description: null,
      location: null,
      ends_at: null,
      all_day: false,
      kind: "other",
      amount_due: null,
      currency: null,
      payment_due_date: null,
      email_id: null,
      status: "confirmed",
      calendar_name: null,
      html_link: null,
      is_demo: false,
      updated_at: now,
    },
    unique: [["id"], ["user_id", "source", "external_id"]],
    touchUpdatedAt: true,
  },
  tasks: {
    defaults: { ...base, notes: null, due_at: null, remind_at: null, is_reminder: false, priority: "normal", completed_at: null, is_demo: false },
    unique: [["id"]],
  },
  notifications: {
    defaults: { ...base, body: null, severity: "info", link: null, data: () => ({}), read_at: null, is_demo: false },
    unique: [["id"], ["user_id", "dedupe_key"]],
  },
  audit_log: { defaults: { details: () => ({}), created_at: now }, unique: [["id"]] },
};

/** Foreign keys: deleting a parent row cascades or nulls the referencing column. */
export const FOREIGN_KEYS: { table: string; column: string; references: string; onDelete: "cascade" | "set null" }[] = [
  { table: "transactions", column: "account_id", references: "accounts", onDelete: "cascade" },
  { table: "transactions", column: "subscription_id", references: "subscriptions", onDelete: "set null" },
  { table: "transactions", column: "category_id", references: "categories", onDelete: "set null" },
  { table: "subscriptions", column: "category_id", references: "categories", onDelete: "set null" },
  { table: "budgets", column: "category_id", references: "categories", onDelete: "cascade" },
  { table: "category_rules", column: "category_id", references: "categories", onDelete: "cascade" },
  { table: "events", column: "email_id", references: "emails", onDelete: "set null" },
  { table: "accounts", column: "connection_id", references: "connections", onDelete: "set null" },
  { table: "emails", column: "connection_id", references: "connections", onDelete: "set null" },
  { table: "sync_runs", column: "connection_id", references: "connections", onDelete: "cascade" },
  { table: "connection_secrets", column: "connection_id", references: "connections", onDelete: "cascade" },
];

export const SYSTEM_CATEGORIES: Row[] = [
  ["groceries", "Food & groceries", "expense", "shopping-basket", 10],
  ["restaurants", "Restaurants & takeaway", "expense", "utensils", 20],
  ["shopping", "Shopping", "expense", "shopping-bag", 30],
  ["entertainment", "Entertainment", "expense", "clapperboard", 40],
  ["transport", "Transport", "expense", "tram-front", 50],
  ["travel", "Travel", "expense", "plane", 60],
  ["subscriptions", "Subscriptions", "expense", "repeat", 70],
  ["housing", "Housing", "expense", "house", 80],
  ["bills", "Bills & utilities", "expense", "receipt", 90],
  ["business", "Business expenses", "expense", "briefcase", 100],
  ["health", "Health & fitness", "expense", "heart-pulse", 110],
  ["cash", "Cash withdrawals", "expense", "banknote", 120],
  ["other", "Other", "expense", "circle-dashed", 999],
  ["salary", "Salary", "income", "wallet", 200],
  ["other_income", "Other income", "income", "piggy-bank", 210],
  ["refunds", "Refunds & reimbursements", "income", "undo-2", 220],
  ["transfers", "Transfers between own accounts", "transfer", "arrow-left-right", 300],
].map(([id, name, kind, icon, sort_order]) => ({ id, user_id: null, name, kind, icon, is_system: true, sort_order, created_at: "2026-01-01T00:00:00.000Z" }));

export function withDefaults(table: string, row: Row): Row {
  const def = TABLES[table];
  if (!def) throw new Error(`Unknown table "${table}"`);
  const out: Row = {};
  for (const [k, v] of Object.entries(def.defaults)) out[k] = typeof v === "function" ? (v as () => unknown)() : v;
  for (const [k, v] of Object.entries(row)) if (v !== undefined) out[k] = v;
  return out;
}
