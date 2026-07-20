-- RLS isolation assertions for the ledger. Runs as an authenticated user with a
-- simulated JWT (via request.jwt.claims), so it exercises the real policies and
-- grants. Any failed assertion aborts the script with a non-zero exit (psql
-- ON_ERROR_STOP), failing CI. Wrapped in a transaction and rolled back.

\set ON_ERROR_STOP on
begin;

-- Three users: Alice and Bob start in separate households; Carol later joins Alice.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'carol@example.com');

-- ── Act as Alice ─────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@example.com"}', true);

select public.create_household('Alice House', 'Alice') as hid \gset
select set_config('test.hid', :'hid', false);

-- A freshly created household has no invite code; a member opts in explicitly.
do $$ begin
  assert (select invite_code from public.households where id = current_setting('test.hid')::uuid) is null,
    'A new household should have no invite code';
end $$;

select invite_code as code from public.create_invite_code() \gset
select set_config('test.code', :'code', false);

do $$ begin
  assert (select invite_code from public.households where id = current_setting('test.hid')::uuid) = current_setting('test.code'),
    'create_invite_code should set the household''s code';
  assert (select invite_code_expires_at from public.households where id = current_setting('test.hid')::uuid) > now(),
    'create_invite_code should set a future expiry';
end $$;

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

-- Alice's inflows and tax profile. A taxable inflow is attributed to her own
-- member; a non-taxable inflow (a reimbursement) carries no member tag.
select id as mid from public.members where household_id = current_setting('test.hid')::uuid \gset
select set_config('test.mid', :'mid', false);

insert into public.inflows (household_id, member_id, name, type, schedule, amount_cents)
  values (current_setting('test.hid')::uuid, current_setting('test.mid')::uuid, 'Acme salary', 'salary', 'annual', 12000000);

insert into public.inflows (household_id, name, taxable, type, schedule, amount_cents)
  values (current_setting('test.hid')::uuid, 'Travel reimbursement', false, 'reimbursement', 'monthly', 8000);

insert into public.tax_profile (household_id, member_id, financial_year)
  values (current_setting('test.hid')::uuid, current_setting('test.mid')::uuid, 2027);

do $$ begin
  assert (select count(*) from public.inflows) = 2, 'Alice should see both her inflows';
  assert (select count(*) from public.inflows where taxable = false and member_id is null) = 1,
    'Alice should be able to create a non-taxable inflow with no member tag';
  assert (select count(*) from public.tax_profile) = 1, 'Alice should see her tax profile';
end $$;

-- Alice's budget: a savings goal, a savings budget line funding that goal, and a
-- date-driven temporary item.
insert into public.savings_goal (household_id, name, target_amount_cents, target_date)
  values (current_setting('test.hid')::uuid, 'Emergency fund', 20000_00, '2027-06-30');
select id as gid from public.savings_goal limit 1 \gset
select set_config('test.gid', :'gid', false);

insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, goal_id)
  values (current_setting('test.hid')::uuid, 'savings', 'Emergency fund top-up', 500_00, 'fortnightly', current_setting('test.gid')::uuid);

insert into public.temporary_item (household_id, name, contribution_cents, target_date)
  values (current_setting('test.hid')::uuid, 'Ski trip', 200_00, '2027-08-01');

do $$ begin
  assert (select count(*) from public.savings_goal) = 1, 'Alice should see her savings goal';
  assert (select count(*) from public.budget_line) = 1, 'Alice should see her budget line';
  assert (select count(*) from public.budget_line where goal_id = current_setting('test.gid')::uuid) = 1,
    'Alice''s budget line should link to her savings goal';
  assert (select count(*) from public.temporary_item) = 1, 'Alice should see her temporary item';
end $$;

-- Alice links her goal to a same-household account (in practice a synced Up
-- saver); the composite FK on (id, household_id) accepts a same-household link.
update public.savings_goal
  set linked_account_id = current_setting('test.aid')::uuid
  where id = current_setting('test.gid')::uuid;

do $$ begin
  assert (select linked_account_id from public.savings_goal where id = current_setting('test.gid')::uuid)
    = current_setting('test.aid')::uuid,
    'Alice should be able to link her goal to her own account';
end $$;

-- Alice's superannuation: a per-year profile linked to a same-household account
-- for its balance, and two contributions attributed to her — a percent-of-salary
-- salary sacrifice and a fixed FHSS-eligible non-concessional amount.
insert into public.super_profile (household_id, member_id, financial_year, fund_name, linked_account_id)
  values (current_setting('test.hid')::uuid, current_setting('test.mid')::uuid, 2027, 'AustralianSuper', current_setting('test.aid')::uuid);

insert into public.super_contribution (household_id, member_id, financial_year, kind, mode, percent_bp, frequency)
  values (current_setting('test.hid')::uuid, current_setting('test.mid')::uuid, 2027, 'salary_sacrifice', 'percent', 500, 'fortnightly');

insert into public.super_contribution (household_id, member_id, financial_year, kind, mode, amount_cents, frequency, fhss_eligible)
  values (current_setting('test.hid')::uuid, current_setting('test.mid')::uuid, 2027, 'personal_non_concessional', 'amount', 1000_00, 'annual', true);

do $$ begin
  assert (select count(*) from public.super_profile) = 1, 'Alice should see her super profile';
  assert (select linked_account_id from public.super_profile where member_id = current_setting('test.mid')::uuid)
    = current_setting('test.aid')::uuid, 'Alice''s super profile should link to her own account';
  assert (select count(*) from public.super_contribution) = 2, 'Alice should see both her super contributions';
end $$;

-- Alice's gift tracker: a recipient and an occasion, a gift budget linking the
-- two, and a purchase against it. The composite FKs on (id, household_id) accept
-- same-household links. She also marks her Gifts budget line as derived from the
-- gift tracker rather than typed.
insert into public.gift_recipient (household_id, name)
  values (current_setting('test.hid')::uuid, 'Mum');
select id as rid from public.gift_recipient limit 1 \gset
select set_config('test.rid', :'rid', false);

insert into public.gift_occasion (household_id, name, occasion_date)
  values (current_setting('test.hid')::uuid, 'Christmas', '2027-12-25');
select id as oid from public.gift_occasion limit 1 \gset
select set_config('test.oid', :'oid', false);

insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('test.hid')::uuid, current_setting('test.rid')::uuid, current_setting('test.oid')::uuid, 150_00);
select id as gbid from public.gift_budget limit 1 \gset
select set_config('test.gbid', :'gbid', false);

insert into public.gift_purchase (household_id, gift_budget_id, amount_cents, description, purchased_on)
  values (current_setting('test.hid')::uuid, current_setting('test.gbid')::uuid, 80_00, 'Book', '2027-12-01');

insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, derived_source, destination_account_id)
  values (current_setting('test.hid')::uuid, 'discretionary', 'Gifts', 0, 'annual', 'gift', current_setting('test.aid')::uuid);

do $$ begin
  assert (select count(*) from public.gift_recipient) = 1, 'Alice should see her gift recipient';
  assert (select count(*) from public.gift_occasion) = 1, 'Alice should see her gift occasion';
  assert (select count(*) from public.gift_budget) = 1, 'Alice should see her gift budget';
  assert (select count(*) from public.gift_budget
    where recipient_id = current_setting('test.rid')::uuid
      and occasion_id = current_setting('test.oid')::uuid) = 1,
    'Alice''s gift budget should link her recipient and occasion';
  assert (select count(*) from public.gift_purchase) = 1, 'Alice should see her gift purchase';
  assert (select count(*) from public.gift_purchase
    where gift_budget_id = current_setting('test.gbid')::uuid) = 1,
    'Alice''s gift purchase should link to her gift budget';
  assert (select count(*) from public.budget_line where derived_source = 'gift') = 1,
    'Alice should see her gift-derived budget line';
  assert (select destination_account_id from public.budget_line where derived_source = 'gift')
    = current_setting('test.aid')::uuid,
    'Alice''s gift budget line should route to her own account';
end $$;

-- Alice's medication tracker: a medication with a recurring cost, and a Needs
-- budget line marked as derived from the medication tracker rather than typed.
insert into public.medication (household_id, name, dose, amount_cents, frequency)
  values (current_setting('test.hid')::uuid, 'Vitamin D', '1000 IU daily', 20_00, 'monthly');

insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, derived_source)
  values (current_setting('test.hid')::uuid, 'needs', 'Medications', 0, 'annual', 'medication');

do $$ begin
  assert (select count(*) from public.medication) = 1, 'Alice should see her medication';
  assert (select count(*) from public.budget_line where derived_source = 'medication') = 1,
    'Alice should see her medication-derived budget line';
end $$;

-- Alice confirms the fortnightly pay split she has set in Up for her account;
-- the composite FK on (id, household_id) accepts a same-household link.
insert into public.pay_split (household_id, account_id, confirmed_fortnightly_cents)
  values (current_setting('test.hid')::uuid, current_setting('test.aid')::uuid, 350_00);

do $$ begin
  assert (select count(*) from public.pay_split) = 1, 'Alice should see her pay split';
  assert (select account_id from public.pay_split) = current_setting('test.aid')::uuid,
    'Alice''s pay split should link to her own account';
end $$;

-- ── Server-side grants: service_role reads members and upserts accounts ──────

-- The Up edge functions act as service_role directly against the ledger
-- (resolveCaller selects a member; up-sync selects members and upserts
-- accounts). service_role bypasses RLS, so these prove the table grants alone.
-- Wrapped in a savepoint so the demo account does not disturb later counts;
-- service_role holds no DELETE grant, so it cannot clean the row up itself.
reset role;
set local role service_role;
savepoint svc_grants;
do $$ begin
  assert (select count(*) from public.members) >= 1,
    'service_role should select from members';
end $$;
insert into public.accounts (household_id, name, source, external_id)
  values (current_setting('test.hid')::uuid, 'Up Everyday', 'up', 'up-acct-demo');
update public.accounts set balance_cents = 500_00 where external_id = 'up-acct-demo';
do $$ begin
  assert (select balance_cents from public.accounts where external_id = 'up-acct-demo') = 500_00,
    'service_role should insert into and update accounts';
end $$;
rollback to savepoint svc_grants;
reset role;
set local role authenticated;

-- ── Up token: Vault storage is service-role-only, never client-readable ──────

-- The token RPCs must not be executable by an authenticated (client) role.
do $$ begin
  assert not has_function_privilege('authenticated', 'public.store_up_token(uuid, text)', 'execute'),
    'authenticated must not execute store_up_token';
  assert not has_function_privilege('authenticated', 'public.up_token_for_member(uuid)', 'execute'),
    'authenticated must not execute up_token_for_member';
  assert not has_function_privilege('authenticated', 'public.clear_up_token(uuid)', 'execute'),
    'authenticated must not execute clear_up_token';
  -- service_role (the edge functions' identity) is the only grantee.
  assert has_function_privilege('service_role', 'public.up_token_for_member(uuid)', 'execute'),
    'service_role should execute up_token_for_member';
end $$;

-- Calling the read RPC as an authenticated user is denied outright.
do $$ begin
  perform public.up_token_for_member(current_setting('test.mid')::uuid);
  raise exception 'FAIL: authenticated read the Up token via up_token_for_member';
exception when insufficient_privilege then
  raise notice 'PASS: authenticated blocked from up_token_for_member';
end $$;

-- No client-facing table or view exposes the token. Checked as the superuser
-- because merely naming a vault relation needs schema USAGE, which authenticated
-- also lacks; has_table_privilege still reports authenticated's own privilege.
reset role;
do $$ begin
  assert not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select'),
    'authenticated must not select vault.decrypted_secrets';
  assert not has_table_privilege('authenticated', 'vault.secrets', 'select'),
    'authenticated must not select vault.secrets';
end $$;

-- service_role (the edge functions' identity) can store a token; verification
-- reads run as the superuser (the shim grants service_role no table access).
reset role;
set local role service_role;
select public.store_up_token(current_setting('test.mid')::uuid, 'up:demo-token');
reset role;
do $$ begin
  assert public.up_token_for_member(current_setting('test.mid')::uuid) = 'up:demo-token',
    'the stored token should round-trip through the service-role read path';
  assert (select up_connected_at from public.members where id = current_setting('test.mid')::uuid) is not null,
    'storing a token should stamp up_connected_at';
end $$;

-- Alice sees her own connection status (the flag), but never the token.
set local role authenticated;
do $$ begin
  assert (select up_connected_at from public.members where id = current_setting('test.mid')::uuid) is not null,
    'Alice should see her own up_connected_at status';
end $$;

-- Alice can still edit her own profile fields (column-scoped UPDATE grant).
update public.members set name = 'Alice Renamed' where id = current_setting('test.mid')::uuid;
do $$ begin
  assert (select name from public.members where id = current_setting('test.mid')::uuid) = 'Alice Renamed',
    'Alice should be able to update her own name';
end $$;

-- But Alice cannot forge her Up connection: up_connected_at is not in her
-- column-level UPDATE grant, so a direct write is rejected and the flag holds.
do $$ begin
  update public.members set up_connected_at = now() - interval '1 year'
    where id = current_setting('test.mid')::uuid;
  raise exception 'FAIL: Alice changed up_connected_at directly';
exception when insufficient_privilege then
  raise notice 'PASS: Alice blocked from writing up_connected_at';
end $$;

-- service_role can clear it; the token and status are gone afterwards.
reset role;
set local role service_role;
select public.clear_up_token(current_setting('test.mid')::uuid);
reset role;
do $$ begin
  assert public.up_token_for_member(current_setting('test.mid')::uuid) is null,
    'clearing should remove the stored token';
  assert (select up_connected_at from public.members where id = current_setting('test.mid')::uuid) is null,
    'clearing should null up_connected_at';
end $$;
set local role authenticated;

-- ── Act as Bob (same role, different JWT) ────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"bob@example.com"}', true);

do $$ begin
  assert (select count(*) from public.households) = 0, 'Bob must not see Alice''s household';
  assert (select count(*) from public.accounts) = 0, 'Bob must not see Alice''s accounts';
  assert (select count(*) from public.transactions) = 0, 'Bob must not see Alice''s transactions';
  assert (select count(*) from public.inflows) = 0, 'Bob must not see Alice''s inflows';
  assert (select count(*) from public.tax_profile) = 0, 'Bob must not see Alice''s tax profiles';
  assert (select count(*) from public.savings_goal) = 0, 'Bob must not see Alice''s savings goals';
  assert (select count(*) from public.budget_line) = 0, 'Bob must not see Alice''s budget lines';
  assert (select count(*) from public.temporary_item) = 0, 'Bob must not see Alice''s temporary items';
  assert (select count(*) from public.super_profile) = 0, 'Bob must not see Alice''s super profiles';
  assert (select count(*) from public.super_contribution) = 0, 'Bob must not see Alice''s super contributions';
  assert (select count(*) from public.gift_recipient) = 0, 'Bob must not see Alice''s gift recipients';
  assert (select count(*) from public.gift_occasion) = 0, 'Bob must not see Alice''s gift occasions';
  assert (select count(*) from public.gift_budget) = 0, 'Bob must not see Alice''s gift budgets';
  assert (select count(*) from public.gift_purchase) = 0, 'Bob must not see Alice''s gift purchases';
  assert (select count(*) from public.medication) = 0, 'Bob must not see Alice''s medications';
  assert (select count(*) from public.pay_split) = 0, 'Bob must not see Alice''s pay splits';
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

-- ── Act as Carol: invite-code lifecycle and joining ──────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","email":"carol@example.com"}', true);

do $$ begin
  assert (select count(*) from public.households) = 0, 'Carol must not see Alice''s household before joining';
end $$;

-- Without a household, Carol can neither mint nor revoke a code — the RPCs
-- self-gate on membership, so they cannot touch Alice's household.
do $$ begin
  perform public.create_invite_code();
  raise exception 'FAIL: Carol minted a code without a household';
exception when others then
  if sqlerrm = 'caller has no household' then
    raise notice 'PASS: create_invite_code requires a household';
  else raise; end if;
end $$;

do $$ begin
  perform public.revoke_invite_code();
  raise exception 'FAIL: Carol revoked a code without a household';
exception when others then
  if sqlerrm = 'caller has no household' then
    raise notice 'PASS: revoke_invite_code requires a household';
  else raise; end if;
end $$;

-- Expire Alice's code (as Alice, a member) and confirm join_household rejects it.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@example.com"}', true);
update public.households set invite_code_expires_at = now() - interval '1 day'
  where id = current_setting('test.hid')::uuid;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","email":"carol@example.com"}', true);
do $$ begin
  perform public.join_household(current_setting('test.code'), 'Carol');
  raise exception 'FAIL: Carol joined with an expired code';
exception when others then
  if sqlerrm = 'invalid or expired invite code' then
    raise notice 'PASS: expired code rejected';
  else raise; end if;
end $$;

-- Alice regenerates a fresh code (Carol still cannot see her household).
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@example.com"}', true);
select invite_code as code from public.create_invite_code() \gset
select set_config('test.code', :'code', false);

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","email":"carol@example.com"}', true);
select public.join_household(current_setting('test.code'), 'Carol');

do $$ begin
  assert (select count(*) from public.households) = 1, 'Carol should see Alice''s household after joining';
  assert (select id from public.households) = current_setting('test.hid')::uuid, 'Carol should be in Alice''s household';
  assert (select count(*) from public.members) = 2, 'Carol should see both herself and Alice';
  assert (select count(*) from public.accounts) = 1, 'Carol should see Alice''s account';
  assert (select count(*) from public.transactions) = 1, 'Carol should see Alice''s transaction';
  assert (select count(*) from public.inflows) = 2, 'Carol should see Alice''s inflows';
  assert (select count(*) from public.tax_profile) = 1, 'Carol should see Alice''s tax profile';
  assert (select count(*) from public.savings_goal) = 1, 'Carol should see Alice''s savings goal';
  assert (select count(*) from public.budget_line) = 3, 'Carol should see all three of Alice''s budget lines';
  assert (select count(*) from public.budget_line where derived_source = 'gift') = 1,
    'Carol should see Alice''s gift-derived budget line';
  assert (select count(*) from public.budget_line where derived_source = 'medication') = 1,
    'Carol should see Alice''s medication-derived budget line';
  assert (select count(*) from public.temporary_item) = 1, 'Carol should see Alice''s temporary item';
  assert (select count(*) from public.super_profile) = 1, 'Carol should see Alice''s super profile';
  assert (select count(*) from public.super_contribution) = 2, 'Carol should see Alice''s super contributions';
  assert (select count(*) from public.gift_recipient) = 1, 'Carol should see Alice''s gift recipient';
  assert (select count(*) from public.gift_occasion) = 1, 'Carol should see Alice''s gift occasion';
  assert (select count(*) from public.gift_budget) = 1, 'Carol should see Alice''s gift budget';
  assert (select count(*) from public.gift_purchase) = 1, 'Carol should see Alice''s gift purchase';
  assert (select count(*) from public.medication) = 1, 'Carol should see Alice''s medication';
  assert (select count(*) from public.pay_split) = 1, 'Carol should see Alice''s pay split';
  assert (select invite_code from public.households where id = current_setting('test.hid')::uuid) is null,
    'Joining should consume the invite code';
end $$;

-- The code is single-use: a second join with the same code fails.
do $$ begin
  perform public.join_household(current_setting('test.code'), 'Carol');
  raise exception 'FAIL: invite code was reusable';
exception when others then
  if sqlerrm = 'invalid or expired invite code' then
    raise notice 'PASS: invite code is single-use';
  else raise; end if;
end $$;

rollback;
