-- RLS isolation assertions for the ledger. Runs as an authenticated user with a
-- simulated JWT (via request.jwt.claims), so it exercises the real policies and
-- grants. Any failed assertion aborts the script with a non-zero exit (psql
-- ON_ERROR_STOP), failing CI. Wrapped in a transaction and rolled back.

\set ON_ERROR_STOP on
begin;

-- Two users in separate households: Alice and Bob.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'bob@example.com');

-- ── Act as Alice ─────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@example.com"}', true);

select public.create_household('Alice House', 'Alice') as hid \gset
select set_config('test.hid', :'hid', false);

do $$ begin
  assert (select count(*) from public.households) = 1, 'Alice should see exactly her household';
  assert (select count(*) from public.members) = 1, 'Alice should see exactly herself';
end $$;

insert into public.accounts (household_id, name)
  values (current_setting('test.hid')::uuid, 'Everyday');
select id as aid from public.accounts limit 1 \gset
select set_config('test.aid', :'aid', false);

insert into public.transactions (household_id, account_id, posted_at, amount_cents, kind)
  values (current_setting('test.hid')::uuid, current_setting('test.aid')::uuid, now(), -1234, 'expense');

do $$ begin
  assert (select count(*) from public.accounts) = 1, 'Alice should see her account';
  assert (select count(*) from public.transactions) = 1, 'Alice should see her transaction';
end $$;

-- ── Act as Bob (same role, different JWT) ────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"bob@example.com"}', true);

do $$ begin
  assert (select count(*) from public.households) = 0, 'Bob must not see Alice''s household';
  assert (select count(*) from public.accounts) = 0, 'Bob must not see Alice''s accounts';
  assert (select count(*) from public.transactions) = 0, 'Bob must not see Alice''s transactions';
end $$;

-- Bob must be blocked from writing into Alice's household (RLS WITH CHECK).
do $$
declare v_hid uuid := current_setting('test.hid')::uuid;
begin
  insert into public.accounts (household_id, name) values (v_hid, 'Sneaky');
  raise exception 'FAIL: Bob was able to insert into Alice''s household';
exception
  when insufficient_privilege then
    raise notice 'PASS: Bob blocked from inserting into Alice''s household';
end $$;

rollback;
