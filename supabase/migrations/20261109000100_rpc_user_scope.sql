-- Analytics RPCs: allow trusted server code (service role, e.g. the daily cron)
-- to compute figures for a specific user. For signed-in callers auth.uid()
-- always wins, so a user can never read someone else's data via p_user_id.
drop function if exists public.spending_by_period(date, date, text);
drop function if exists public.spending_by_category(date, date);
drop function if exists public.spending_by_merchant(date, date, integer);

create or replace function public.spending_by_period(p_from date, p_to date, p_grain text default 'day', p_user_id uuid default null)
returns table (period date, spent numeric, income numeric, refunds numeric, tx_count bigint)
language sql stable set search_path = ''
as $$
  select
    date_trunc(p_grain, t.booked_at)::date as period,
    coalesce(sum(-t.amount) filter (where t.kind in ('expense', 'withdrawal', 'fee')), 0)
      - coalesce(sum(t.amount) filter (where t.kind = 'refund'), 0) as spent,
    coalesce(sum(t.amount) filter (where t.kind = 'income'), 0) as income,
    coalesce(sum(t.amount) filter (where t.kind = 'refund'), 0) as refunds,
    count(*) as tx_count
  from public.transactions t
  where t.user_id = coalesce(auth.uid(), p_user_id)
    and t.booked_at between p_from and p_to
    and t.kind <> 'transfer'
  group by 1
  order by 1;
$$;

create or replace function public.spending_by_category(p_from date, p_to date, p_user_id uuid default null)
returns table (category_id text, spent numeric, tx_count bigint)
language sql stable set search_path = ''
as $$
  select coalesce(t.category_id, 'other') as category_id, sum(-t.amount) as spent, count(*) as tx_count
  from public.transactions t
  where t.user_id = coalesce(auth.uid(), p_user_id)
    and t.booked_at between p_from and p_to
    and t.kind in ('expense', 'withdrawal', 'fee', 'refund')
  group by 1
  having sum(-t.amount) > 0
  order by 2 desc;
$$;

create or replace function public.spending_by_merchant(p_from date, p_to date, p_limit integer default 20, p_user_id uuid default null)
returns table (merchant text, merchant_key text, spent numeric, tx_count bigint, last_seen date)
language sql stable set search_path = ''
as $$
  select
    max(coalesce(t.merchant, t.counterparty_name, 'Unknown')) as merchant,
    coalesce(t.merchant_key, lower(coalesce(t.merchant, t.counterparty_name, 'unknown'))) as merchant_key,
    sum(-t.amount) as spent,
    count(*) as tx_count,
    max(t.booked_at) as last_seen
  from public.transactions t
  where t.user_id = coalesce(auth.uid(), p_user_id)
    and t.booked_at between p_from and p_to
    and t.kind in ('expense', 'withdrawal', 'fee', 'refund')
  group by 2
  having sum(-t.amount) > 0
  order by 3 desc
  limit greatest(1, least(p_limit, 200));
$$;

revoke all on function public.spending_by_period(date, date, text, uuid) from public, anon;
revoke all on function public.spending_by_category(date, date, uuid) from public, anon;
revoke all on function public.spending_by_merchant(date, date, integer, uuid) from public, anon;
grant execute on function public.spending_by_period(date, date, text, uuid) to authenticated, service_role;
grant execute on function public.spending_by_category(date, date, uuid) to authenticated, service_role;
grant execute on function public.spending_by_merchant(date, date, integer, uuid) to authenticated, service_role;
