-- Assertions for notification_preference: a member's own on/off choice for one
-- notification trigger.
--
-- Like push_subscription, this is member-scoped, not household-shared: a
-- co-member can neither read nor change another member's notification choices,
-- even though they share every other planning table. The evaluator
-- (`service_role`) reads preferences and nothing else — no insert, update, or
-- delete, which only a member's own browser does.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'notif-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'notif-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'notif-carol@example.com');

-- ── Alice's household; Bob joins it, Carol is a separate household ────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"notif-alice@example.com"}', true);
select public.create_household('Notif Household', 'Alice') as db_hid \gset
select set_config('db.hid', :'db_hid', false);
select invite_code as db_code from public.create_invite_code() \gset
select set_config('db.code', :'db_code', false);

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000002","email":"notif-bob@example.com"}', true);
select public.join_household(current_setting('db.code'), 'Bob');

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000003","email":"notif-carol@example.com"}', true);
select public.create_household('Other Household', 'Carol') as db_hid2 \gset
select set_config('db.hid2', :'db_hid2', false);

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"notif-alice@example.com"}', true);
select id as db_alice_mid from public.members
  where household_id = current_setting('db.hid')::uuid and name = 'Alice' \gset
select set_config('db.alice_mid', :'db_alice_mid', false);
select id as db_bob_mid from public.members
  where household_id = current_setting('db.hid')::uuid and name = 'Bob' \gset
select set_config('db.bob_mid', :'db_bob_mid', false);

-- ── Grants: authenticated manages, service_role only reads ───────────────────

do $$ begin
  assert has_table_privilege('authenticated', 'public.notification_preference', 'select'),
    'authenticated should select notification_preference';
  assert has_table_privilege('authenticated', 'public.notification_preference', 'insert'),
    'authenticated should insert notification_preference';
  assert has_table_privilege('authenticated', 'public.notification_preference', 'update'),
    'authenticated should update notification_preference';
  assert has_table_privilege('authenticated', 'public.notification_preference', 'delete'),
    'authenticated should delete notification_preference';
  assert has_table_privilege('service_role', 'public.notification_preference', 'select'),
    'service_role should select notification_preference (the evaluator reads it)';
  assert not has_table_privilege('service_role', 'public.notification_preference', 'insert'),
    'service_role must not insert notification_preference';
  assert not has_table_privilege('service_role', 'public.notification_preference', 'update'),
    'service_role must not update notification_preference';
  assert not has_table_privilege('service_role', 'public.notification_preference', 'delete'),
    'service_role must not delete notification_preference';
end $$;

-- ── Alice manages her own preferences ───────────────────────────────────────

insert into public.notification_preference (household_id, member_id, trigger, enabled)
  values (current_setting('db.hid')::uuid, current_setting('db.alice_mid')::uuid, 'buffer_negative', false);

do $$ begin
  assert (select count(*) from public.notification_preference) = 1,
    'Alice should read her own preference';
  assert (select enabled from public.notification_preference
    where member_id = current_setting('db.alice_mid')::uuid and trigger = 'buffer_negative') = false,
    'Alice''s buffer_negative preference should be off';
end $$;

-- One row per (member, trigger): a second insert for the same pair is rejected.
do $$ begin
  insert into public.notification_preference (household_id, member_id, trigger, enabled)
    values (current_setting('db.hid')::uuid, current_setting('db.alice_mid')::uuid, 'buffer_negative', true);
  raise exception 'FAIL: a duplicate (member, trigger) preference was inserted';
exception when unique_violation then
  raise notice 'PASS: a member has at most one row per trigger';
end $$;

-- Alice cannot attribute a preference to her co-member.
do $$ begin
  insert into public.notification_preference (household_id, member_id, trigger, enabled)
    values (current_setting('db.hid')::uuid, current_setting('db.bob_mid')::uuid, 'fy_boundary', false);
  raise exception 'FAIL: Alice set a preference for her co-member';
exception when insufficient_privilege then
  raise notice 'PASS: a member cannot set a preference for a co-member';
end $$;

-- ── Bob sees and changes only his own ──────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000002","email":"notif-bob@example.com"}', true);

do $$ begin
  assert (select count(*) from public.notification_preference) = 0,
    'Bob must not see Alice''s preference';
end $$;

insert into public.notification_preference (household_id, member_id, trigger, enabled)
  values (current_setting('db.hid')::uuid, current_setting('db.bob_mid')::uuid, 'goal_eta_slipped', false);

do $$ begin
  assert (select count(*) from public.notification_preference) = 1,
    'Bob should see only his own preference';
end $$;

-- Bob's update and delete of Alice's row match nothing under RLS rather than
-- erroring; the row is checked intact below, as Alice.
update public.notification_preference set enabled = true
  where member_id = current_setting('db.alice_mid')::uuid;
delete from public.notification_preference
  where member_id = current_setting('db.alice_mid')::uuid;

-- ── The other household sees nothing ───────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000003","email":"notif-carol@example.com"}', true);
do $$ begin
  assert (select count(*) from public.notification_preference) = 0,
    'a separate household must not see Notif Household''s preferences';
end $$;

-- ── Back as Alice: neither of Bob's writes touched her row ─────────────────

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"notif-alice@example.com"}', true);
do $$ begin
  assert (select count(*) from public.notification_preference
    where member_id = current_setting('db.alice_mid')::uuid) = 1,
    'a co-member''s update/delete must not touch Alice''s preference';
  assert (select enabled from public.notification_preference
    where member_id = current_setting('db.alice_mid')::uuid) = false,
    'Alice''s preference value should be untouched by the blocked update';
end $$;

-- Her own delete (turning the row back to the default "on") works.
delete from public.notification_preference where member_id = current_setting('db.alice_mid')::uuid;
do $$ begin
  assert (select count(*) from public.notification_preference
    where member_id = current_setting('db.alice_mid')::uuid) = 0,
    'Alice should delete her own preference';
end $$;

rollback;
