-- Assertions for notification_log: the evaluator's private dedupe ledger.
--
-- Nothing client-facing reads or writes it — no `authenticated` grant and no
-- `authenticated` policy — so a member cannot see which of their devices were
-- told what, only that a notification arrived. `service_role` (the evaluator)
-- holds select and insert alone: it appends a row when it sends and reads the
-- recent rows to skip a send it already made. The `(member, trigger,
-- dedupe_key)` unique key is the dedupe.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'log-alice@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000001","email":"log-alice@example.com"}', true);
select public.create_household('Log Household', 'Alice') as db_hid \gset
select set_config('db.hid', :'db_hid', false);
select id as db_mid from public.members where household_id = current_setting('db.hid')::uuid \gset
select set_config('db.mid', :'db_mid', false);

-- ── Grants: authenticated has none; service_role has select + insert only ────

do $$ begin
  assert not has_table_privilege('authenticated', 'public.notification_log', 'select'),
    'authenticated must not select notification_log';
  assert not has_table_privilege('authenticated', 'public.notification_log', 'insert'),
    'authenticated must not insert notification_log';
  assert not has_table_privilege('authenticated', 'public.notification_log', 'update'),
    'authenticated must not update notification_log';
  assert not has_table_privilege('authenticated', 'public.notification_log', 'delete'),
    'authenticated must not delete notification_log';
  assert has_table_privilege('service_role', 'public.notification_log', 'select'),
    'service_role should select notification_log';
  assert has_table_privilege('service_role', 'public.notification_log', 'insert'),
    'service_role should insert notification_log';
  assert not has_table_privilege('service_role', 'public.notification_log', 'update'),
    'service_role must not update notification_log';
  assert not has_table_privilege('service_role', 'public.notification_log', 'delete'),
    'service_role must not delete notification_log';
end $$;

do $$ begin
  assert (select relrowsecurity from pg_class where oid = 'public.notification_log'::regclass),
    'notification_log must have row-level security enabled';
end $$;

-- A member selecting the log directly is denied outright.
do $$ begin
  perform 1 from public.notification_log;
  raise exception 'FAIL: authenticated selected notification_log';
exception when insufficient_privilege then
  raise notice 'PASS: authenticated blocked from selecting notification_log';
end $$;

-- ── service_role appends and dedupes ───────────────────────────────────────

reset role;
set local role service_role;

insert into public.notification_log (household_id, member_id, trigger, dedupe_key)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'buffer_negative', '2027');

do $$ begin
  assert (select count(*) from public.notification_log) = 1,
    'service_role should append a log row';
end $$;

-- The same (member, trigger, dedupe_key) is the same notification: rejected.
do $$ begin
  insert into public.notification_log (household_id, member_id, trigger, dedupe_key)
    values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'buffer_negative', '2027');
  raise exception 'FAIL: a duplicate (member, trigger, dedupe_key) log row was inserted';
exception when unique_violation then
  raise notice 'PASS: the dedupe key rejects a repeat send';
end $$;

-- A different dedupe_key for the same trigger is a distinct notification.
insert into public.notification_log (household_id, member_id, trigger, dedupe_key)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'buffer_negative', '2028');
do $$ begin
  assert (select count(*) from public.notification_log) = 2,
    'a distinct dedupe_key is a distinct notification';
end $$;

reset role;
rollback;
