-- Assertions for redbark_connection.
--
-- Every write goes through an edge function that resolves the caller itself
-- (redbark-connect-complete / redbark-disconnect / redbark-sync), so writes are
-- service_role-only; a household member may only ever read — a co-member's
-- connection included, same as every other household-scoped table — never
-- insert, update, or delete a row directly.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'redbark-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'redbark-bob@example.com');

-- ── Alice's household: two members, one connection each ─────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","email":"redbark-alice@example.com"}', true);
select public.create_household('Alice Household', 'Alice') as hid \gset
select set_config('test.hid', :'hid', false);
select id as mid from public.members where household_id = :'hid' \gset
select set_config('test.mid', :'mid', false);
select invite_code as code from public.create_invite_code() \gset
select set_config('test.code', :'code', false);

select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000002","email":"redbark-bob@example.com"}', true);
select public.join_household(current_setting('test.code'), 'Bob');
select id as mid2 from public.members where household_id = :'hid' and user_id = '70000000-0000-0000-0000-000000000002' \gset
select set_config('test.mid2', :'mid2', false);

reset role;
set local role service_role;
insert into public.redbark_connection (id, household_id, member_id, institution_name, status) values
  ('conn_alice_anz', :'hid', :'mid', 'ANZ', 'active'),
  ('conn_bob_cba', :'hid', :'mid2', 'CBA', 'active');

-- ── Bob's household: one connection, to prove isolation ─────────────────────

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000002","email":"redbark-bob@example.com"}', true);
select public.create_household('Bob Household', 'Bob') as hid2 \gset
select id as mid3 from public.members where household_id = :'hid2' \gset

reset role;
set local role service_role;
insert into public.redbark_connection (id, household_id, member_id, institution_name, status)
  values ('conn_bob_other_household', :'hid2', :'mid3', 'Macquarie', 'active');

-- ── A household member reads their own household's connections, both members'
--    included — ownership within a household is attribution, not privacy ──────

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","email":"redbark-alice@example.com"}', true);

do $$ begin
  assert (select count(*) from public.redbark_connection where household_id = current_setting('test.hid')::uuid) = 2,
    'a household member should see both connections in their own household';
  assert exists (select 1 from public.redbark_connection where id = 'conn_bob_cba'),
    'a household member should see a co-member''s connection too';
  assert not exists (select 1 from public.redbark_connection where id = 'conn_bob_other_household'),
    'a member must not see another household''s connection';
end $$;

-- ── No direct write path: every mutation goes through an edge function ──────

do $$
declare v_hid uuid := current_setting('test.hid')::uuid;
declare v_mid uuid := current_setting('test.mid')::uuid;
begin
  begin
    insert into public.redbark_connection (id, household_id, member_id, status)
      values ('conn_direct_insert', v_hid, v_mid, 'active');
    raise exception 'FAIL: authenticated inserted a redbark_connection row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from inserting redbark_connection directly';
  end;

  begin
    update public.redbark_connection set status = 'revoked' where id = 'conn_alice_anz';
    raise exception 'FAIL: authenticated updated a redbark_connection row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from updating redbark_connection directly';
  end;

  begin
    delete from public.redbark_connection where id = 'conn_alice_anz';
    raise exception 'FAIL: authenticated deleted a redbark_connection row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from deleting redbark_connection directly';
  end;
end $$;

-- ── service_role bypasses RLS and holds every grant ─────────────────────────

reset role;
set local role service_role;
savepoint svc_grants;
update public.redbark_connection set status = 'revoked' where id = 'conn_bob_other_household';
do $$ begin
  assert (select status from public.redbark_connection where id = 'conn_bob_other_household') = 'revoked',
    'service_role should update any household''s redbark_connection row';
end $$;
delete from public.redbark_connection where id = 'conn_bob_other_household';
do $$ begin
  assert not exists (select 1 from public.redbark_connection where id = 'conn_bob_other_household'),
    'service_role should delete any household''s redbark_connection row';
end $$;
rollback to savepoint svc_grants;

rollback;
