// Row types mirroring supabase/migrations. Kept hand-written and small on purpose.

export type TransactionKind = "expense" | "income" | "transfer" | "refund" | "withdrawal" | "fee";
export type BillingCycle = "weekly" | "monthly" | "quarterly" | "semiannual" | "yearly" | "unknown";
export type SubscriptionStatus = "active" | "trial" | "cancellation_pending" | "cancelled" | "paused" | "expired";
export type EmailCategory =
  | "receipt"
  | "purchase"
  | "order"
  | "shipping"
  | "subscription"
  | "trial"
  | "renewal"
  | "cancellation"
  | "bill"
  | "booking"
  | "travel"
  | "appointment"
  | "important"
  | "other";
export type EventKind =
  | "flight"
  | "hotel"
  | "restaurant"
  | "appointment"
  | "meeting"
  | "ticket"
  | "delivery"
  | "payment"
  | "travel"
  | "personal"
  | "other";
export type Severity = "info" | "success" | "warning" | "critical";

export interface Profile {
  id: string;
  display_name: string | null;
  base_currency: string;
  locale: string;
  timezone: string;
  theme: "dark" | "light" | "system";
  ai_assistant_enabled: boolean;
  ai_email_extraction_enabled: boolean;
  notification_prefs: Partial<NotificationPrefs>;
  email_retention_days: number;
  large_purchase_threshold: number;
  onboarded_at: string | null;
  created_at: string;
}

export interface NotificationPrefs {
  upcoming_payment: boolean;
  trial_ending: boolean;
  new_recurring: boolean;
  price_increase: boolean;
  large_purchase: boolean;
  upcoming_bill: boolean;
  event_soon: boolean;
  unusual_spending: boolean;
  charge_after_cancel: boolean;
  days_ahead: number;
}

export interface Category {
  id: string;
  user_id: string | null;
  name: string;
  kind: "expense" | "income" | "transfer";
  icon: string;
  is_system: boolean;
  sort_order: number;
}

export interface Connection {
  id: string;
  user_id: string;
  provider: "google" | "enable_banking";
  label: string;
  scopes: string[];
  status: "active" | "error" | "expired" | "revoked";
  consent_expires_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  sync_state: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  connection_id: string | null;
  source: "bank" | "csv" | "manual" | "demo";
  external_id: string;
  name: string;
  institution: string | null;
  iban_masked: string | null;
  iban_hash: string | null;
  currency: string;
  type: "checking" | "savings" | "credit_card" | "cash" | "other";
  balance: number | null;
  balance_updated_at: string | null;
  include_in_totals: boolean;
  is_demo: boolean;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string | null;
  source: "bank" | "csv" | "manual" | "demo";
  external_id: string;
  booked_at: string;
  value_date: string | null;
  amount: number;
  currency: string;
  description: string | null;
  merchant: string | null;
  merchant_key: string | null;
  counterparty_name: string | null;
  counterparty_iban_masked: string | null;
  counterparty_iban_hash: string | null;
  mcc: string | null;
  kind: TransactionKind;
  category_id: string | null;
  category_source: "auto" | "rule" | "user" | "ai";
  subscription_id: string | null;
  status: "booked" | "pending";
  notes: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  name: string;
  provider: string | null;
  merchant_key: string;
  category_id: string | null;
  amount: number | null;
  currency: string;
  billing_cycle: BillingCycle;
  status: SubscriptionStatus;
  next_payment_date: string | null;
  last_payment_date: string | null;
  last_payment_amount: number | null;
  previous_amount: number | null;
  price_changed_at: string | null;
  started_at: string | null;
  trial_ends_at: string | null;
  payment_method: string | null;
  cancel_url: string | null;
  cancel_instructions: string | null;
  cancellation_deadline: string | null;
  cancellation_requested_at: string | null;
  cancellation_confirmed_at: string | null;
  cancellation_reference: string | null;
  detection_source: "bank" | "email" | "manual" | "demo";
  detection_confidence: number | null;
  charge_count: number;
  last_email_at: string | null;
  user_confirmed: boolean;
  dismissed: boolean;
  last_reviewed_at: string | null;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface Budget {
  id: string;
  user_id: string;
  category_id: string;
  amount: number;
}

export interface EmailRecord {
  id: string;
  user_id: string;
  /** The mailbox this came from; null for sample data or after its account was disconnected. */
  connection_id?: string | null;
  provider: string;
  external_id: string;
  thread_id: string | null;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  category: EmailCategory;
  is_important: boolean;
  merchant: string | null;
  merchant_key: string | null;
  amount: number | null;
  currency: string | null;
  order_number: string | null;
  due_date: string | null;
  event_start: string | null;
  event_end: string | null;
  location: string | null;
  extracted: Record<string, unknown>;
  extraction_method: "rules" | "ai" | "demo";
  web_link: string | null;
  is_demo: boolean;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  source: "google" | "email" | "manual" | "demo";
  external_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  kind: EventKind;
  amount_due: number | null;
  currency: string | null;
  payment_due_date: string | null;
  email_id: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  calendar_name: string | null;
  html_link: string | null;
  is_demo: boolean;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  remind_at: string | null;
  is_reminder: boolean;
  priority: "low" | "normal" | "high";
  completed_at: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  severity: Severity;
  link: string | null;
  dedupe_key: string;
  data: Record<string, unknown>;
  read_at: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface SyncRun {
  id: string;
  connection_id: string | null;
  kind: string;
  status: "running" | "success" | "error";
  stats: Record<string, unknown>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface PeriodPoint {
  period: string;
  spent: number;
  income: number;
  refunds: number;
  tx_count: number;
}

export interface CategorySpend {
  category_id: string;
  spent: number;
  tx_count: number;
}

export interface MerchantSpend {
  merchant: string;
  merchant_key: string;
  spent: number;
  tx_count: number;
  last_seen: string;
}
