-- Assertions for apns_device: a native install's APNs device token.
--
-- Like push_subscription, this is member-scoped, not household-shared: a token is
-- a bearer capability to make someone's phone buzz, so a co-member can neither
-- read nor delete it. The sender (`service_role`) reads devices and prunes dead
-- ones; it never inserts or updates. `register_apns_device` is how the app
-- registers a token, reassigning it to the caller when the install changes hands.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'apns-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'apns-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'apns-carol@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000001","email":"apns-alice@example.com"}', true);
select public.create_household('Apns Household', 'Alice') as db_hid \gset
select set_config('db.hid', :'db_hid', false);
select invite_code as db_code from public.create_invite_code() \gset
select set_config('db.code', :'db_code', false);

select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000002","email":"apns-bob@example.com"}', true);
select public.join_household(current_setting('db.code'), 'Bob');

select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000003","email":"apns-carol@example.com"}', true);
select public.create_household('Other Household', 'Carol') as db_hid2 \gset

select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000001","email":"apns-alice@example.com"}', true);
select id as db_alice_mid from public.members
  where household_id = current_setting('db.hid')::uuid and name = 'Alice' \gset
select set_config('db.alice_mid', :'db_alice_mid', false);
select id as db_bob_mid from public.members
  where household_id = current_setting('db.hid')::uuid and name = 'Bob' \gset
select set_config('db.bob_mid', :'db_bob_mid', false);

-- ── Grants: authenticated manages, service_role selects and deletes ──────────

do $$ begin
  assert has_table_privilege('authenticated', 'public.apns_device', 'select')
    and has_table_privilege('authenticated', 'public.apns_device', 'insert')
    and has_table_privilege('authenticated', 'public.apns_device', 'update')
    and has_table_privilege('authenticated', 'public.apns_device', 'delete'),
    'authenticated should manage apns_device';
  assert has_table_privilege('service_role', 'public.apns_device', 'select'),
    'service_role should select apns_device';
  assert has_table_privilege('service_role', 'public.apns_device', 'delete'),
    'service_role should delete apns_device';
  assert not has_table_privilege('service_role', 'public.apns_device', 'insert'),
    'service_role must not insert apns_device';
  assert not has_table_privilege('service_role', 'public.apns_device', 'update'),
    'service_role must not update apns_device';
  assert (select relrowsecurity from pg_class where oid = 'public.apns_device'::regclass),
    'apns_device must have row-level security enabled';
end $$;

-- ── Alice registers a device; only a known environment is accepted ──────────

select public.register_apns_device('aaaa', 'sandbox');
do $$ begin
  assert (select count(*) from public.apns_device) = 1, 'Alice should see her own device';
  assert (select member_id from public.apns_device where token = 'aaaa') = current_setting('db.alice_mid')::uuid,
    'the device should belong to the caller';
end $$;

-- Registering the same token again refreshes it in place.
select public.register_apns_device('aaaa', 'production');
do $$ begin
  assert (select count(*) from public.apns_device) = 1, 'a re-registration must not duplicate the token';
  assert (select environment from public.apns_device where token = 'aaaa') = 'production',
    'a re-registration should refresh the environment';
end $$;

do $$ begin
  perform public.register_apns_device('bbbb', 'staging');
  raise exception 'FAIL: an unknown environment was accepted';
exception when check_violation then
  raise notice 'PASS: only sandbox and production environments are accepted';
end $$;

-- Alice cannot attribute a device to her co-member directly.
do $$ begin
  insert into public.apns_device (household_id, member_id, token, environment)
    values (current_setting('db.hid')::uuid, current_setting('db.bob_mid')::uuid, 'forged', 'sandbox');
  raise exception 'FAIL: Alice registered a device for her co-member';
exception when insufficient_privilege then
  raise notice 'PASS: a member cannot register a device for a co-member';
end $$;

-- ── Bob sees and deletes only his own ──────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000002","email":"apns-bob@example.com"}', true);
do $$ begin
  assert (select count(*) from public.apns_device) = 0, 'Bob must not see Alice''s device';
end $$;
delete from public.apns_device where token = 'aaaa';

-- ── Carol's household sees nothing ─────────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000003","email":"apns-carol@example.com"}', true);
do $$ begin
  assert (select count(*) from public.apns_device) = 0, 'a separate household must not see the device';
end $$;

-- ── Alice's device survived Bob's delete ───────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000001","email":"apns-alice@example.com"}', true);
do $$ begin
  assert (select count(*) from public.apns_device where token = 'aaaa') = 1,
    'a co-member''s delete must not touch Alice''s device';
end $$;

-- ── The install changes hands: Bob registers the same token ────────────────

select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000002","email":"apns-bob@example.com"}', true);
select public.register_apns_device('aaaa', 'production');
do $$ begin
  assert (select member_id from public.apns_device where token = 'aaaa') = current_setting('db.bob_mid')::uuid,
    'registering a token should reassign it to the caller';
end $$;

select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000001","email":"apns-alice@example.com"}', true);
do $$ begin
  assert (select count(*) from public.apns_device) = 0, 'Alice must lose a token Bob took over';
end $$;

-- Bob's own delete (sign-out) removes it.
select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000002","email":"apns-bob@example.com"}', true);
delete from public.apns_device where token = 'aaaa';
do $$ begin
  assert (select count(*) from public.apns_device) = 0, 'Bob should delete his own device';
end $$;

-- ── The APNs credential set is service-role-only ───────────────────────────

do $$ begin
  perform public.apns_keys();
  raise exception 'FAIL: a member read the APNs credential set';
exception when insufficient_privilege then
  raise notice 'PASS: apns_keys is not executable by a member';
end $$;

rollback;
