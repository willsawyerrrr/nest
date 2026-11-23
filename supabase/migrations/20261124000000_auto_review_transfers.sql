-- Transfers arrive already reviewed.
--
-- A Transfer transaction (between accounts, a cover or forward, or from another
-- person) needs no human decision, so `sync_up_transactions` stamps
-- `reviewed_at` when it inserts one, as it does for Salary and Interest,
-- leaving `reviewed_by_member_id` null. Rows already in the ledger are
-- backfilled below.

create or replace function public.sync_up_transactions(p_household_id uuid, p_rows jsonb)
returns table (id uuid, inserted boolean)
language sql
security definer
set search_path = ''
as $$
  with upserted as (
    insert into public.transactions as t
      (household_id, account_id, member_id, posted_at, amount_cents, description,
       kind, status, source, external_id, external_category, external_parent_category,
       is_categorizable, transaction_type, deep_link_url, up_message, up_note,
       performing_customer_name, reviewed_at)
    select
      p_household_id,
      (r ->> 'account_id')::uuid,
      nullif(r ->> 'member_id', '')::uuid,
      (r ->> 'posted_at')::timestamptz,
      (r ->> 'amount_cents')::bigint,
      coalesce(r ->> 'description', ''),
      (r ->> 'kind')::public.transaction_kind,
      (r ->> 'status')::public.transaction_status,
      'up',
      r ->> 'external_id',
      r ->> 'external_category',
      r ->> 'external_parent_category',
      (r ->> 'is_categorizable')::boolean,
      r ->> 'transaction_type',
      r ->> 'deep_link_url',
      r ->> 'up_message',
      r ->> 'up_note',
      r ->> 'performing_customer_name',
      case when r ->> 'transaction_type' in ('Salary', 'Interest', 'Transfer') then now() end
    from jsonb_array_elements(p_rows) as r
    on conflict (source, external_id) do update set
      account_id = excluded.account_id,
      member_id = excluded.member_id,
      posted_at = excluded.posted_at,
      amount_cents = excluded.amount_cents,
      description = excluded.description,
      kind = excluded.kind,
      status = excluded.status,
      external_category = excluded.external_category,
      external_category_since = case
        when t.external_category is distinct from excluded.external_category then now()
        else t.external_category_since
      end,
      external_parent_category = excluded.external_parent_category,
      is_categorizable = excluded.is_categorizable,
      transaction_type = excluded.transaction_type,
      deep_link_url = excluded.deep_link_url,
      up_message = excluded.up_message,
      up_note = excluded.up_note,
      performing_customer_name = excluded.performing_customer_name
    where t.household_id = excluded.household_id
    returning t.id, t.amount_cents, t.xmax = 0 as inserted
  ),
  repriced as (
    update public.gift_purchase gp
      set amount_cents = abs(u.amount_cents)
      from upserted u
      where gp.transaction_id = u.id
        and gp.amount_cents <> abs(u.amount_cents)
  )
  select u.id, u.inserted from upserted u;
$$;

update public.transactions
  set reviewed_at = now()
  where source = 'up'
    and transaction_type = 'Transfer'
    and reviewed_at is null;
