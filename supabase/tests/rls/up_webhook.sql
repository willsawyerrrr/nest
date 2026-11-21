-- Assertions for `up_webhook` and its Vault-backed RPCs: store_up_webhook,
-- up_webhook_secret_for_member, and clear_up_webhook.
--
-- Nothing client-facing touches either: `authenticated` holds no table grant
-- and no policy, and cannot execute any of the three RPCs. `service_role`
-- selects the table and writes it only through the RPCs, which store the
-- webhook id and its secret together, replace both on a re-registration, and
-- clear both together. Deleting the member cascades to the row.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'up-wh-alice@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"64000000-0000-0000-0000-000000000001","email":"up-wh-alice@example.com"}', true);
select public.create_household('Up Webhook Household', 'Alice') as hid \gset
select id as mid from public.members where household_id = :'hid' \gset
select set_config('test.mid', :'mid', false);
reset role;

-- ── Grants ────────────────────────────────────────────────────────────────────

do $$ begin
  assert (select relrowsecurity from pg_class where oid = 'public.up_webhook'::regclass),
    'up_webhook must have row-level security enabled';
  assert not has_table_privilege('authenticated', 'public.up_webhook', 'select'),
    'authenticated must not select up_webhook';
  assert not has_table_privilege('authenticated', 'public.up_webhook', 'insert'),
    'authenticated must not insert up_webhook';
  assert has_table_privilege('service_role', 'public.up_webhook', 'select'),
    'service_role should select up_webhook';
  assert not has_table_privilege('service_role', 'public.up_webhook', 'insert'),
    'service_role must write up_webhook only through store_up_webhook';
  assert not has_table_privilege('service_role', 'public.up_webhook', 'delete'),
    'service_role must clear up_webhook only through clear_up_webhook';
  assert not has_function_privilege('authenticated', 'public.store_up_webhook(uuid, text, text)', 'execute'),
    'authenticated must not store a webhook';
  assert not has_function_privilege('authenticated', 'public.up_webhook_secret_for_member(uuid)', 'execute'),
    'authenticated must not read a webhook secret';
  assert not has_function_privilege('authenticated', 'public.clear_up_webhook(uuid)', 'execute'),
    'authenticated must not clear a webhook';
  assert has_function_privilege('service_role', 'public.up_webhook_secret_for_member(uuid)', 'execute'),
    'service_role should read a webhook secret';
end $$;

-- ── service_role stores, replaces, reads, and clears ──────────────────────────

set local role service_role;
select public.store_up_webhook(current_setting('test.mid')::uuid, 'wh-1', 'secret-1');
select public.store_up_webhook(current_setting('test.mid')::uuid, 'wh-2', 'secret-2');

do $$ begin
  assert (select webhook_id from public.up_webhook where member_id = current_setting('test.mid')::uuid) = 'wh-2',
    're-registering should replace the stored webhook id';
  assert public.up_webhook_secret_for_member(current_setting('test.mid')::uuid) = 'secret-2',
    're-registering should replace the stored secret';
  assert public.up_webhook_secret_for_member(gen_random_uuid()) is null,
    'an unknown member has no secret';
end $$;
reset role;

do $$ begin
  assert (select count(*) from vault.secrets
    where name = 'up_webhook_secret:' || current_setting('test.mid')) = 1,
    'one Vault secret per member';
end $$;

set local role service_role;
select public.clear_up_webhook(current_setting('test.mid')::uuid);
do $$ begin
  assert not exists (select 1 from public.up_webhook where member_id = current_setting('test.mid')::uuid),
    'clearing should delete the row';
  assert public.up_webhook_secret_for_member(current_setting('test.mid')::uuid) is null,
    'clearing should delete the secret';
end $$;

select public.store_up_webhook(current_setting('test.mid')::uuid, 'wh-3', 'secret-3');
reset role;

-- ── authenticated sees and calls nothing ─────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"64000000-0000-0000-0000-000000000001","email":"up-wh-alice@example.com"}', true);
do $$ begin
  perform 1 from public.up_webhook;
  raise exception 'FAIL: authenticated selected up_webhook';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.up_webhook_secret_for_member(current_setting('test.mid')::uuid);
  raise exception 'FAIL: authenticated read a webhook secret';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ── Deleting the member removes its row ──────────────────────────────────────

delete from public.members where id = current_setting('test.mid')::uuid;
do $$ begin
  assert not exists (select 1 from public.up_webhook where member_id = current_setting('test.mid')::uuid),
    'deleting the member should cascade to up_webhook';
end $$;

rollback;
