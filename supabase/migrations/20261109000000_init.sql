-- =============================================================================
-- Command Centre: initial schema
--
-- Every user-owned table carries a user_id and is protected by row-level
-- security so that a user can only ever read or write their own rows.
-- OAuth tokens / bank session ids live in `connection_secrets`, which has RLS
-- enabled and NO policies: only the service role (server-side code) can touch
-- it, and the values are additionally AES-256-GCM encrypted by the app.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles & preferences
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  base_currency text not null default 'EUR',
  locale text not null default 'en-BE',
  timezone text not null default 'Europe/Brussels',
  theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  -- Explicit consent switches for sending data to the AI provider (GDPR).
  ai_assistant_enabled boolean not null default false,
  ai_email_extraction_enabled boolean not null default false,
  notification_prefs jsonb not null default '{}'::jsonb,
  -- Extracted email metadata older than this is purged by the retention job.
  email_retention_days integer not null default 730 check (email_retention_days between 30 and 3650),
  large_purchase_threshold numeric(12, 2) not null default 150,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Categories (system rows have user_id null and a readable text id)
-- ---------------------------------------------------------------------------
create table public.categories (
  id text primary key default gen_random_uuid()::text,
  user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'expense' check (kind in ('expense', 'income', 'transfer')),
  icon text not null default 'circle',
  is_system boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);
create index categories_user_idx on public.categories (user_id);

insert into public.categories (id, user_id, name, kind, icon, is_system, sort_order) values
  ('groceries',     null, 'Food & groceries',          'expense',  'shopping-basket', true, 10),
  ('restaurants',   null, 'Restaurants & takeaway',    'expense',  'utensils',        true, 20),
  ('shopping',      null, 'Shopping',                  'expense',  'shopping-bag',    true, 30),
  ('entertainment', null, 'Entertainment',             'expense',  'clapperboard',    true, 40),
  ('transport',     null, 'Transport',                 'expense',  'tram-front',      true, 50),
  ('travel',        null, 'Travel',                    'expense',  'plane',           true, 60),
  ('subscriptions', null, 'Subscriptions',             'expense',  'repeat',          true, 70),
  ('housing',       null, 'Housing',                   'expense',  'house',           true, 80),
  ('bills',         null, 'Bills & utilities',         'expense',  'receipt',         true, 90),
  ('business',      null, 'Business expenses',         'expense',  'briefcase',       true, 100),
  ('health',        null, 'Health & fitness',          'expense',  'heart-pulse',     true, 110),
  ('cash',          null, 'Cash withdrawals',          'expense',  'banknote',        true, 120),
  ('other',         null, 'Other',                     'expense',  'circle-dashed',   true, 999),
  ('salary',        null, 'Salary',                    'income',   'wallet',          true, 200),
  ('other_income',  null, 'Other income',              'income',   'piggy-bank',      true, 210),
  ('refunds',       null, 'Refunds & reimbursements',  'income',   'undo-2',          true, 220),
  ('transfers',     null, 'Transfers between own accounts', 'transfer', 'arrow-left-right', true, 300);

create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pattern text not null check (char_length(pattern) between 2 and 120),
  category_id text not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, pattern)
);

-- ---------------------------------------------------------------------------
-- Connections (OAuth / PSD2) and their encrypted secrets
-- ---------------------------------------------------------------------------
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'enable_banking')),
  label text not null,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'error', 'expired', 'revoked')),
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  sync_state jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, label)
);
create trigger connections_updated_at before update on public.connections
  for each row execute function public.set_updated_at();

create table public.connection_secrets (
  connection_id uuid primary key references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.connections (id) on delete cascade,
  kind text not null,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  stats jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index sync_runs_user_idx on public.sync_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Money: accounts, transactions, budgets
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.connections (id) on delete set null,
  source text not null check (source in ('bank', 'csv', 'manual', 'demo')),
  external_id text not null,
  name text not null,
  institution text,
  iban_masked text,
  iban_hash text,
  currency text not null default 'EUR',
  type text not null default 'checking' check (type in ('checking', 'savings', 'credit_card', 'cash', 'other')),
  balance numeric(14, 2),
  balance_updated_at timestamptz,
  include_in_totals boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);
create trigger accounts_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  provider text,
  merchant_key text not null,
  category_id text references public.categories (id) on delete set null default 'subscriptions',
  amount numeric(12, 2),
  currency text not null default 'EUR',
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('weekly', 'monthly', 'quarterly', 'semiannual', 'yearly', 'unknown')),
  status text not null default 'active'
    check (status in ('active', 'trial', 'cancellation_pending', 'cancelled', 'paused', 'expired')),
  next_payment_date date,
  last_payment_date date,
  last_payment_amount numeric(12, 2),
  previous_amount numeric(12, 2),
  price_changed_at date,
  started_at date,
  trial_ends_at date,
  payment_method text,
  cancel_url text,
  cancel_instructions text,
  cancellation_deadline date,
  cancellation_requested_at timestamptz,
  cancellation_confirmed_at timestamptz,
  cancellation_reference text,
  detection_source text not null default 'manual' check (detection_source in ('bank', 'email', 'manual', 'demo')),
  detection_confidence numeric(4, 3),
  charge_count integer not null default 0,
  last_email_at timestamptz,
  user_confirmed boolean not null default false,
  dismissed boolean not null default false,
  last_reviewed_at timestamptz,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_key, billing_cycle)
);
create index subscriptions_user_status_idx on public.subscriptions (user_id, status);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete cascade,
  source text not null check (source in ('bank', 'csv', 'manual', 'demo')),
  external_id text not null,
  booked_at date not null,
  value_date date,
  amount numeric(14, 2) not null,           -- signed: negative = money out
  currency text not null default 'EUR',
  description text,
  merchant text,                             -- normalised display merchant
  merchant_key text,                         -- normalised matching key
  counterparty_name text,
  counterparty_iban_masked text,
  counterparty_iban_hash text,
  mcc text,
  kind text not null default 'expense'
    check (kind in ('expense', 'income', 'transfer', 'refund', 'withdrawal', 'fee')),
  category_id text references public.categories (id) on delete set null,
  category_source text not null default 'auto' check (category_source in ('auto', 'rule', 'user', 'ai')),
  subscription_id uuid references public.subscriptions (id) on delete set null,
  status text not null default 'booked' check (status in ('booked', 'pending')),
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);
create index transactions_user_date_idx on public.transactions (user_id, booked_at desc);
create index transactions_user_category_idx on public.transactions (user_id, category_id, booked_at desc);
create index transactions_user_merchant_idx on public.transactions (user_id, merchant_key, booked_at desc);
create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id text not null references public.categories (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (user_id, category_id)
);

-- ---------------------------------------------------------------------------
-- Email intelligence (structured extractions only - full bodies are never stored)
-- ---------------------------------------------------------------------------
create table public.emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.connections (id) on delete set null,
  provider text not null default 'gmail',
  external_id text not null,
  thread_id text,
  from_name text,
  from_email text,
  subject text,
  snippet text,
  received_at timestamptz not null,
  category text not null default 'other' check (category in (
    'receipt', 'purchase', 'order', 'shipping', 'subscription', 'trial', 'renewal',
    'cancellation', 'bill', 'booking', 'travel', 'appointment', 'important', 'other')),
  is_important boolean not null default false,
  merchant text,
  merchant_key text,
  amount numeric(14, 2),
  currency text,
  order_number text,
  due_date date,
  event_start timestamptz,
  event_end timestamptz,
  location text,
  extracted jsonb not null default '{}'::jsonb,
  extraction_method text not null default 'rules' check (extraction_method in ('rules', 'ai', 'demo')),
  web_link text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('simple',
      coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' || coalesce(from_email, '') || ' ' ||
      coalesce(merchant, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(order_number, ''))
  ) stored,
  unique (user_id, provider, external_id)
);
create index emails_user_received_idx on public.emails (user_id, received_at desc);
create index emails_user_category_idx on public.emails (user_id, category, received_at desc);
create index emails_search_idx on public.emails using gin (search);

-- ---------------------------------------------------------------------------
-- Planning: events, tasks
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('google', 'email', 'manual', 'demo')),
  external_id text not null default gen_random_uuid()::text,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  kind text not null default 'other' check (kind in (
    'flight', 'hotel', 'restaurant', 'appointment', 'meeting', 'ticket', 'delivery',
    'payment', 'travel', 'personal', 'other')),
  amount_due numeric(12, 2),
  currency text,
  payment_due_date date,
  email_id uuid references public.emails (id) on delete set null,
  status text not null default 'confirmed' check (status in ('confirmed', 'tentative', 'cancelled')),
  calendar_name text,
  html_link text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);
create index events_user_start_idx on public.events (user_id, starts_at);
create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  notes text,
  due_at timestamptz,
  remind_at timestamptz,
  is_reminder boolean not null default false,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  completed_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index tasks_user_due_idx on public.tasks (user_id, completed_at, due_at);

-- ---------------------------------------------------------------------------
-- Notifications & audit log
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'critical')),
  link text,
  dedupe_key text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_user_idx on public.audit_log (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.category_rules enable row level security;
alter table public.connections enable row level security;
alter table public.connection_secrets enable row level security;
alter table public.sync_runs enable row level security;
alter table public.accounts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.emails enable row level security;
alter table public.events enable row level security;
alter table public.tasks enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- Anonymous visitors get nothing at all.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- Profiles: own row only (insert happens through the auth trigger).
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Categories: everyone reads system rows; users manage their own.
create policy categories_select on public.categories for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy categories_insert on public.categories for insert to authenticated
  with check (user_id = (select auth.uid()) and is_system = false);
create policy categories_update on public.categories for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and is_system = false);
create policy categories_delete on public.categories for delete to authenticated
  using (user_id = (select auth.uid()));

-- Generic "own rows" policy for the user-owned tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'category_rules', 'accounts', 'subscriptions', 'transactions', 'budgets',
    'emails', 'events', 'tasks', 'notifications'
  ] loop
    execute format(
      'create policy %1$s_own on public.%1$I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- Connections: users can see and delete (disconnect) their connections, but
-- creating/updating them is done by server code with the service role.
create policy connections_select on public.connections for select to authenticated
  using (user_id = (select auth.uid()));
create policy connections_delete on public.connections for delete to authenticated
  using (user_id = (select auth.uid()));

-- Sync runs and audit log are read-only for the user.
create policy sync_runs_select on public.sync_runs for select to authenticated
  using (user_id = (select auth.uid()));
create policy audit_log_select on public.audit_log for select to authenticated
  using (user_id = (select auth.uid()));

-- connection_secrets: deliberately NO policies. Revoke table privileges too.
revoke all on public.connection_secrets from authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.categories, public.category_rules, public.accounts,
  public.subscriptions, public.transactions, public.budgets, public.emails, public.events,
  public.tasks, public.notifications to authenticated;
grant select, delete on public.connections to authenticated;
grant select on public.sync_runs, public.audit_log to authenticated;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Audit helper callable by the signed-in user (user_id is forced to auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.log_audit(p_action text, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (user_id, action, details)
  select auth.uid(), left(p_action, 80), coalesce(p_details, '{}'::jsonb)
  where auth.uid() is not null;
$$;
revoke all on function public.log_audit(text, jsonb) from public, anon;
grant execute on function public.log_audit(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Analytics functions (security invoker => RLS still applies).
-- Spending = expenses + cash withdrawals + fees, net of refunds.
-- Transfers between own accounts are always excluded.
-- ---------------------------------------------------------------------------
create or replace function public.spending_by_period(
  p_from date,
  p_to date,
  p_grain text default 'day'
)
returns table (period date, spent numeric, income numeric, refunds numeric, tx_count bigint)
language sql
stable
set search_path = ''
as $$
  select
    date_trunc(p_grain, t.booked_at)::date as period,
    coalesce(sum(-t.amount) filter (where t.kind in ('expense', 'withdrawal', 'fee')), 0)
      - coalesce(sum(t.amount) filter (where t.kind = 'refund'), 0) as spent,
    coalesce(sum(t.amount) filter (where t.kind = 'income'), 0) as income,
    coalesce(sum(t.amount) filter (where t.kind = 'refund'), 0) as refunds,
    count(*) filter (where t.kind <> 'transfer') as tx_count
  from public.transactions t
  where t.user_id = auth.uid()
    and t.booked_at between p_from and p_to
    and t.kind <> 'transfer'
  group by 1
  order by 1;
$$;

create or replace function public.spending_by_category(p_from date, p_to date)
returns table (category_id text, spent numeric, tx_count bigint)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(t.category_id, 'other') as category_id,
    sum(-t.amount) as spent,
    count(*) as tx_count
  from public.transactions t
  where t.user_id = auth.uid()
    and t.booked_at between p_from and p_to
    and t.kind in ('expense', 'withdrawal', 'fee', 'refund')
  group by 1
  having sum(-t.amount) > 0
  order by 2 desc;
$$;

create or replace function public.spending_by_merchant(p_from date, p_to date, p_limit integer default 20)
returns table (merchant text, merchant_key text, spent numeric, tx_count bigint, last_seen date)
language sql
stable
set search_path = ''
as $$
  select
    max(coalesce(t.merchant, t.counterparty_name, 'Unknown')) as merchant,
    coalesce(t.merchant_key, lower(coalesce(t.merchant, t.counterparty_name, 'unknown'))) as merchant_key,
    sum(-t.amount) as spent,
    count(*) as tx_count,
    max(t.booked_at) as last_seen
  from public.transactions t
  where t.user_id = auth.uid()
    and t.booked_at between p_from and p_to
    and t.kind in ('expense', 'withdrawal', 'fee', 'refund')
  group by 2
  having sum(-t.amount) > 0
  order by 3 desc
  limit greatest(1, least(p_limit, 200));
$$;

revoke all on function public.spending_by_period(date, date, text) from public, anon;
revoke all on function public.spending_by_category(date, date) from public, anon;
revoke all on function public.spending_by_merchant(date, date, integer) from public, anon;
grant execute on function public.spending_by_period(date, date, text) to authenticated;
grant execute on function public.spending_by_category(date, date) to authenticated;
grant execute on function public.spending_by_merchant(date, date, integer) to authenticated;
