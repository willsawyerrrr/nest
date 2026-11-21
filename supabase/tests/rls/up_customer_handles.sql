-- Assertions for up_customer_handles, which learns each member's Up handles
-- for matching a joint-account transaction to its purchaser, and the grants
-- the transaction-review prompt reads under.
--
-- A handle comes only from a member's own individual accounts — never a joint
-- one, where either partner may have made the transaction — and only from the
-- household asked about. service_role alone may call it, and reads
-- `up_category` for the prompt's category name.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '81400000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'handles-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '81400000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'handles-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '81400000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'handles-carol@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81400000-0000-0000-0000-000000000001","email":"handles-alice@example.com"}', true);
select public.create_household('Handles Household', 'Alice') as hid \gset
select set_config('handles.hid', :'hid', false);
select id as amid from public.members where household_id = :'hid'::uuid \gset
select set_config('handles.amid', :'amid', false);
select invite_code as code from public.create_invite_code() \gset

select set_config('request.jwt.claims', '{"sub":"81400000-0000-0000-0000-000000000002","email":"handles-bob@example.com"}', true);
select public.join_household(:'code', 'Bob');
select id as bmid from public.members where household_id = :'hid'::uuid and id <> :'amid'::uuid \gset
select set_config('handles.bmid', :'bmid', false);

select set_config('request.jwt.claims', '{"sub":"81400000-0000-0000-0000-000000000003","email":"handles-carol@example.com"}', true);
select public.create_household('Carol Household', 'Carol') as chid \gset
select set_config('handles.chid', :'chid', false);
select id as cmid from public.members where household_id = :'chid'::uuid \gset

reset role;

insert into public.accounts (household_id, owner_member_id, name, type, source, external_id) values
  (:'hid', null, 'Joint', 'transaction', 'up', 'handles-joint'),
  (:'hid', :'amid', 'Alice''s Spending', 'transaction', 'up', 'handles-alice'),
  (:'hid', :'bmid', 'Bob''s Spending', 'transaction', 'up', 'handles-bob'),
  (:'chid', :'cmid', 'Carol''s Spending', 'transaction', 'up', 'handles-carol');

insert into public.transactions
  (household_id, account_id, posted_at, amount_cents, description, kind, source, external_id,
   performing_customer_name)
  select a.household_id, a.id, now(), -10_00, 'Spend', 'expense', 'up', 'handles-tx-' || a.external_id || '-' || n,
    case
      when a.external_id = 'handles-joint' then '$intruder'
      when a.external_id = 'handles-alice' then '$alice'
      when a.external_id = 'handles-carol' then '$carol'
      when n = 1 then null
      else '$bob'
    end
  from public.accounts a, generate_series(1, 2) n
  where a.external_id like 'handles-%';

-- ── service_role reads each member's own handles, for one household ──────────

set local role service_role;
do $$
declare
  v_rows text;
begin
  select string_agg(member_id::text || '=' || handle, ',' order by handle) into v_rows
    from public.up_customer_handles(current_setting('handles.hid')::uuid);
  assert v_rows = current_setting('handles.amid') || '=$alice,' || current_setting('handles.bmid') || '=$bob',
    format('expected only Alice''s and Bob''s own handles, got %s', v_rows);
  perform 1 from public.up_category limit 1;
end;
$$;
reset role;

-- ── nobody else may call it ──────────────────────────────────────────────────

do $$ begin
  assert not has_function_privilege('authenticated', 'public.up_customer_handles(uuid)', 'execute'),
    'authenticated must not execute up_customer_handles';
  assert not has_function_privilege('anon', 'public.up_customer_handles(uuid)', 'execute'),
    'anon must not execute up_customer_handles';
  assert has_table_privilege('service_role', 'public.up_category', 'select'),
    'service_role must read up_category';
  assert not has_table_privilege('service_role', 'public.up_category', 'insert'),
    'service_role must hold no write grant on up_category';
end $$;

rollback;
