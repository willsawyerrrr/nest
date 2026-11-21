-- Assertions that deleting a member deletes their Vault secrets: the Up token
-- (`up_token:<member_id>`) and the Up webhook secret
-- (`up_webhook_secret:<member_id>`), whether the member is deleted directly or
-- through their household's cascade. A co-member's secrets and an unrelated
-- secret are untouched, and a member with no secrets deletes cleanly.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'vault-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'vault-carol@example.com'),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'vault-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'vault-dana@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"65000000-0000-0000-0000-000000000001","email":"vault-alice@example.com"}', true);
select public.create_household('Vault Household', 'Alice') as hid \gset
select id as alice from public.members where household_id = :'hid' \gset
select set_config('request.jwt.claims', '{"sub":"65000000-0000-0000-0000-000000000002","email":"vault-carol@example.com"}', true);
select public.create_household('Other Vault Household', 'Carol') as other_hid \gset
select id as carol from public.members where household_id = :'other_hid' \gset
reset role;

insert into public.members (household_id, user_id, name) values (:'hid', '65000000-0000-0000-0000-000000000003', 'Bob') returning id as bob \gset
insert into public.members (household_id, user_id, name) values (:'hid', '65000000-0000-0000-0000-000000000004', 'Dana') returning id as dana \gset
select set_config('test.alice', :'alice', false);
select set_config('test.bob', :'bob', false);
select set_config('test.carol', :'carol', false);
select set_config('test.dana', :'dana', false);

set local role service_role;
select public.store_up_token(:'alice', 'alice-token');
select public.store_up_webhook(:'alice', 'wh-alice', 'alice-secret');
select public.store_up_token(:'bob', 'bob-token');
select public.store_up_webhook(:'bob', 'wh-bob', 'bob-secret');
select public.store_up_token(:'carol', 'carol-token');
select public.store_up_webhook(:'carol', 'wh-carol', 'carol-secret');
reset role;
select vault.create_secret('unrelated', 'up_sync_cron_key');

-- ── Deleting a member deletes both of their secrets ──────────────────────────

delete from public.members where id = :'bob';
do $$ begin
  assert not exists (select 1 from vault.secrets
    where name in ('up_token:' || current_setting('test.bob'), 'up_webhook_secret:' || current_setting('test.bob'))),
    'deleting a member should delete their Up token and webhook secret';
  assert (select count(*) from vault.secrets
    where name in ('up_token:' || current_setting('test.alice'), 'up_webhook_secret:' || current_setting('test.alice'))) = 2,
    'a co-member''s secrets should be untouched';
end $$;

-- ── A member with no secrets deletes cleanly ─────────────────────────────────

delete from public.members where id = :'dana';
do $$ begin
  assert not exists (select 1 from public.members where id = current_setting('test.dana')::uuid),
    'a member with no secrets should delete';
end $$;

-- ── Deleting a household deletes its members' secrets ────────────────────────

delete from public.households where id = :'hid';
do $$ begin
  assert not exists (select 1 from vault.secrets
    where name in ('up_token:' || current_setting('test.alice'), 'up_webhook_secret:' || current_setting('test.alice'))),
    'deleting a household should delete its members'' secrets';
  assert (select count(*) from vault.secrets
    where name in ('up_token:' || current_setting('test.carol'), 'up_webhook_secret:' || current_setting('test.carol'))) = 2,
    'another household''s secrets should be untouched';
  assert exists (select 1 from vault.secrets where name = 'up_sync_cron_key'),
    'a secret not named for a member should be untouched';
end $$;

-- ── The trigger function is not callable by a client ─────────────────────────

do $$ begin
  assert not has_function_privilege('authenticated', 'public.clear_member_vault_secrets()', 'execute'),
    'authenticated must not execute clear_member_vault_secrets';
end $$;

rollback;
