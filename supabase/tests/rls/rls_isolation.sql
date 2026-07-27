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

-- Alice's HELP debt: one standing balance for her member.
insert into public.help_debt (household_id, member_id, balance_cents)
  values (current_setting('test.hid')::uuid, current_setting('test.mid')::uuid, 30000_00);

do $$ begin
  assert (select count(*) from public.help_debt) = 1, 'Alice should see her HELP debt';
  assert (select balance_cents from public.help_debt where member_id = current_setting('test.mid')::uuid)
    = 30000_00, 'Alice''s HELP balance should round-trip';
end $$;

-- Alice's equity: an option grant with a cliff and vesting schedule for her member.
insert into public.equity_grant
  (household_id, member_id, label, instrument_type, quantity, grant_date, cliff_months, vesting_period_months, vesting_frequency, strike_price_cents, price_per_share_cents)
  values (current_setting('test.hid')::uuid, current_setting('test.mid')::uuid, '2024 options', 'option', 10000, '2024-01-15', 12, 48, 'monthly', 50, 3_00);

do $$ begin
  assert (select count(*) from public.equity_grant) = 1, 'Alice should see her equity grant';
  assert (select quantity from public.equity_grant where member_id = current_setting('test.mid')::uuid)
    = 10000, 'Alice''s equity quantity should round-trip';
end $$;

-- Alice's tax deduction: a deductible expense tagged to her member and FY.
insert into public.deduction
  (household_id, member_id, description, amount_cents, deduction_date, financial_year)
  values (current_setting('test.hid')::uuid, current_setting('test.mid')::uuid, 'Home office', 1_200_00, '2026-08-01', 2027);

do $$ begin
  assert (select count(*) from public.deduction) = 1, 'Alice should see her deduction';
  assert (select amount_cents from public.deduction where member_id = current_setting('test.mid')::uuid)
    = 1_200_00, 'Alice''s deduction amount should round-trip';
end $$;

-- Alice's gift tracker: a recipient and an occasion, a gift budget linking the
-- two, and a purchase against it. The composite FKs on (id, household_id) accept
-- same-household links. Her gift budgets roll up into standalone gift budget
-- lines (is_gift_line = true, no breakdown row).
insert into public.gift_recipient (household_id, name)
  values (current_setting('test.hid')::uuid, 'Mum');
select id as rid from public.gift_recipient where name = 'Mum' limit 1 \gset
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

-- The external ("others") gift line is derived, not typed: the reconcile trigger
-- mints a standalone is_gift_line line the moment Alice's gift budget for Mum (an
-- external recipient) lands. Alice routes that line to her own account.
update public.budget_line set destination_account_id = current_setting('test.aid')::uuid
  where is_gift_line and gift_recipient_member_id is null;

-- A per-recipient gift line, discriminated by gift_recipient_member_id: budgeting
-- a gift for Alice's own member recipient makes the trigger mint a "Gifts for
-- <member>" line keyed to her member. The composite FK on (recipient_id,
-- household_id) accepts a same-household recipient.
select id as arid from public.gift_recipient where member_id = current_setting('test.mid')::uuid \gset
select set_config('test.arid', :'arid', false);
insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('test.hid')::uuid, current_setting('test.arid')::uuid, current_setting('test.oid')::uuid, 120_00);

do $$ begin
  assert (select count(*) from public.gift_recipient) = 2,
    'Alice should see her gift recipient plus her own auto-created member recipient';
  assert (select count(*) from public.gift_occasion) = 1, 'Alice should see her gift occasion';
  assert (select count(*) from public.gift_budget) = 2,
    'Alice should see her two gift budgets (Mum''s and her own member''s)';
  assert (select count(*) from public.gift_budget
    where recipient_id = current_setting('test.rid')::uuid
      and occasion_id = current_setting('test.oid')::uuid) = 1,
    'Alice''s gift budget should link her recipient and occasion';
  assert (select count(*) from public.gift_purchase) = 1, 'Alice should see her gift purchase';
  assert (select count(*) from public.gift_purchase
    where gift_budget_id = current_setting('test.gbid')::uuid) = 1,
    'Alice''s gift purchase should link to her gift budget';
  assert (select count(*) from public.budget_line where is_gift_line) = 2,
    'Alice should see her two derived gift lines (external plus her member partition)';
  assert (select destination_account_id from public.budget_line
    where is_gift_line and gift_recipient_member_id is null)
    = current_setting('test.aid')::uuid,
    'Alice''s external gift budget line should route to her own account';
  assert (select count(*) from public.budget_line
    where is_gift_line
      and gift_recipient_member_id = current_setting('test.mid')::uuid) = 1,
    'Alice should see the gift line funding her own member''s gifts';
end $$;

-- Household members are permanent gift recipients. The AFTER INSERT trigger on
-- members auto-created exactly one member-linked recipient for Alice when her
-- household was created; it cannot be edited (the guard trigger rejects the
-- update) and the partial unique index blocks a second recipient for her member.
-- An external recipient (Mum) stays freely editable.
do $$ begin
  assert (select count(*) from public.gift_recipient
    where member_id = current_setting('test.mid')::uuid) = 1,
    'Alice''s member should have exactly one auto-created gift recipient';
end $$;

do $$ begin
  update public.gift_recipient set name = 'Hacked'
    where member_id = current_setting('test.mid')::uuid;
  raise exception 'FAIL: a member gift recipient was edited';
exception when others then
  if sqlerrm = 'Member gift recipients are managed automatically and cannot be edited' then
    raise notice 'PASS: member gift recipient cannot be edited';
  else raise; end if;
end $$;

do $$ begin
  update public.gift_recipient set name = 'Mummy' where id = current_setting('test.rid')::uuid;
  assert (select name from public.gift_recipient where id = current_setting('test.rid')::uuid) = 'Mummy',
    'an external gift recipient should stay editable';
end $$;

do $$ begin
  insert into public.gift_recipient (household_id, member_id, name)
    values (current_setting('test.hid')::uuid, current_setting('test.mid')::uuid, 'Dup');
  raise exception 'FAIL: a duplicate member gift recipient was inserted';
exception when unique_violation then
  raise notice 'PASS: a member may have only one gift recipient';
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

-- Alice's breakdown: a generic breakdown with one item. Its derived budget line
-- is minted by the reconcile trigger the moment the item lands — the composite
-- FKs on (id, household_id) keep the item's breakdown link and the derived line's
-- breakdown link within the household.
insert into public.breakdown (household_id, name, line_group, kind)
  values (current_setting('test.hid')::uuid, 'Medications', 'needs', 'generic');
select id as bdid from public.breakdown where kind = 'generic' limit 1 \gset
select set_config('test.bdid', :'bdid', false);

insert into public.breakdown_item (household_id, breakdown_id, name, amount_cents, frequency)
  values (current_setting('test.hid')::uuid, current_setting('test.bdid')::uuid, 'Prescription', 30_00, 'monthly');

do $$ begin
  assert (select count(*) from public.breakdown) = 1, 'Alice should see her breakdown';
  assert (select count(*) from public.breakdown_item) = 1, 'Alice should see her breakdown item';
  assert (select count(*) from public.breakdown_item
    where breakdown_id = current_setting('test.bdid')::uuid) = 1,
    'Alice''s breakdown item should link to her breakdown';
  assert (select count(*) from public.budget_line where breakdown_id = current_setting('test.bdid')::uuid) = 1,
    'Alice''s derived budget line should link to her breakdown';
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
-- up-sync dual-writes identity and balance through the upsert_up_accounts RPC
-- (SECURITY DEFINER, service_role only); one call upserts both tables atomically.
select public.upsert_up_accounts(jsonb_build_array(jsonb_build_object(
  'household_id', current_setting('test.hid'),
  'owner_member_id', null,
  'name', 'Up Everyday',
  'type', 'transaction',
  'source', 'up',
  'external_id', 'up-acct-demo',
  'currency', 'AUD',
  'balance_cents', 500_00
)));
do $$ begin
  assert (
    select b.balance_cents
    from public.account_balance b
    join public.accounts a on a.id = b.account_id
    where a.external_id = 'up-acct-demo'
  ) = 500_00,
    'service_role upsert_up_accounts writes the account identity and its balance';
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
  assert (select count(*) from public.help_debt) = 0, 'Bob must not see Alice''s HELP debts';
  assert (select count(*) from public.equity_grant) = 0, 'Bob must not see Alice''s equity grants';
  assert (select count(*) from public.deduction) = 0, 'Bob must not see Alice''s deductions';
  assert (select count(*) from public.gift_recipient) = 0, 'Bob must not see Alice''s gift recipients';
  assert (select count(*) from public.gift_occasion) = 0, 'Bob must not see Alice''s gift occasions';
  assert (select count(*) from public.gift_budget) = 0, 'Bob must not see Alice''s gift budgets';
  assert (select count(*) from public.gift_purchase) = 0, 'Bob must not see Alice''s gift purchases';
  assert (select count(*) from public.pay_split) = 0, 'Bob must not see Alice''s pay splits';
  assert (select count(*) from public.breakdown) = 0, 'Bob must not see Alice''s breakdowns';
  assert (select count(*) from public.breakdown_item) = 0, 'Bob must not see Alice''s breakdown items';
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
  assert (select count(*) from public.budget_line) = 4, 'Carol should see all four of Alice''s budget lines';
  assert (select count(*) from public.budget_line where is_gift_line) = 2,
    'Carol should see both of Alice''s gift-derived budget lines';
  assert (select count(*) from public.temporary_item) = 1, 'Carol should see Alice''s temporary item';
  assert (select count(*) from public.super_profile) = 1, 'Carol should see Alice''s super profile';
  assert (select count(*) from public.super_contribution) = 2, 'Carol should see Alice''s super contributions';
  assert (select count(*) from public.help_debt) = 1, 'Carol should see Alice''s HELP debt';
  assert (select count(*) from public.equity_grant) = 1, 'Carol should see Alice''s equity grant';
  assert (select count(*) from public.deduction) = 1, 'Carol should see Alice''s deduction';
  assert (select count(*) from public.gift_recipient) = 3,
    'Carol should see Alice''s external recipient plus both members'' auto-created recipients';
  assert (select count(*) from public.gift_occasion) = 1, 'Carol should see Alice''s gift occasion';
  assert (select count(*) from public.gift_budget) = 2, 'Carol should see both of Alice''s gift budgets';
  assert (select count(*) from public.gift_purchase) = 1, 'Carol should see Alice''s gift purchase';
  assert (select count(*) from public.pay_split) = 1, 'Carol should see Alice''s pay split';
  assert (select count(*) from public.breakdown) = 1, 'Carol should see Alice''s breakdown';
  assert (select count(*) from public.breakdown_item) = 1, 'Carol should see Alice''s breakdown item';
  assert (select count(*) from public.breakdown where id = current_setting('test.bdid')::uuid) = 1,
    'Carol should see Alice''s breakdown by id';
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

-- ── Per-account balance privacy within a single household ────────────────────
--
-- The blocks above prove isolation *between* households. This block proves the
-- new dimension: privacy *within* one household with two members. A member sees
-- the full balance row only for shared accounts, their own accounts, and any
-- household super account; a co-member's private spending and savers are hidden
-- from `accounts` and `transactions` alike, while the identity-only
-- `account_directory` still names any transaction account. A fresh household and
-- uuids keep this independent of the counts asserted above.

-- Two more users who will share one household: Alice owns her own spending
-- account; Bob owns a spending account, a saver, and a super account. Seeding
-- auth.users needs the owner role, as at the top of the script.
reset role;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'privacy-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'privacy-bob@example.com');
set local role authenticated;

-- Alice creates the household and mints an invite code.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
select public.create_household('Privacy House', 'Alice') as priv_hid \gset
select set_config('test.priv_hid', :'priv_hid', false);
select invite_code as priv_code from public.create_invite_code() \gset
select set_config('test.priv_code', :'priv_code', false);

-- Bob joins, so both are members of the one household.
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","email":"privacy-bob@example.com"}', true);
select public.join_household(current_setting('test.priv_code'), 'Bob');

-- Resolve both member ids (a member reads its co-members).
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
select id as priv_alice_mid from public.members
  where household_id = current_setting('test.priv_hid')::uuid
    and user_id = '44444444-4444-4444-4444-444444444444' \gset
select set_config('test.priv_alice_mid', :'priv_alice_mid', false);
select id as priv_bob_mid from public.members
  where household_id = current_setting('test.priv_hid')::uuid
    and user_id = '55555555-5555-5555-5555-555555555555' \gset
select set_config('test.priv_bob_mid', :'priv_bob_mid', false);

-- Alice creates the shared account and her own spending account, then a
-- transaction on the shared account.
insert into public.accounts (household_id, name)
  values (current_setting('test.priv_hid')::uuid, 'Joint Everyday')
  returning id as priv_shared \gset
select set_config('test.priv_shared', :'priv_shared', false);

insert into public.accounts (household_id, owner_member_id, name, type)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_alice_mid')::uuid, 'Alice''s Spending', 'transaction')
  returning id as priv_alice_spending \gset
select set_config('test.priv_alice_spending', :'priv_alice_spending', false);

-- Balances live in account_balance now; Alice records hers for the two accounts
-- she owns/shares (both in her balance-visible set).
insert into public.account_balance (account_id, household_id, balance_cents) values
  (current_setting('test.priv_shared')::uuid, current_setting('test.priv_hid')::uuid, 100_00),
  (current_setting('test.priv_alice_spending')::uuid, current_setting('test.priv_hid')::uuid, 200_00);

insert into public.transactions (household_id, account_id, posted_at, amount_cents, kind)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_shared')::uuid, now(), -50_00, 'expense');

-- Bob creates his own spending account, a saver, and a super account, links the
-- super account via a super_profile row (making it a household super account),
-- and posts a transaction on his spending account.
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","email":"privacy-bob@example.com"}', true);
insert into public.accounts (household_id, owner_member_id, name, type)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_mid')::uuid, 'Bob''s Spending', 'transaction')
  returning id as priv_bob_spending \gset
select set_config('test.priv_bob_spending', :'priv_bob_spending', false);

insert into public.accounts (household_id, owner_member_id, name, type, source, external_id)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_mid')::uuid, 'Bob''s Saver', 'savings', 'up', 'up-priv-bob-saver')
  returning id as priv_bob_saver \gset
select set_config('test.priv_bob_saver', :'priv_bob_saver', false);

insert into public.accounts (household_id, owner_member_id, name, type)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_mid')::uuid, 'Bob''s Super', 'savings')
  returning id as priv_bob_super \gset
select set_config('test.priv_bob_super', :'priv_bob_super', false);

-- Bob records balances for the three accounts he owns (all in his balance-visible
-- set), so the privacy checks below read real values rather than absent rows.
insert into public.account_balance (account_id, household_id, balance_cents) values
  (current_setting('test.priv_bob_spending')::uuid, current_setting('test.priv_hid')::uuid, 300_00),
  (current_setting('test.priv_bob_saver')::uuid, current_setting('test.priv_hid')::uuid, 400_00),
  (current_setting('test.priv_bob_super')::uuid, current_setting('test.priv_hid')::uuid, 500_00);

insert into public.super_profile (household_id, member_id, financial_year, fund_name, linked_account_id)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_mid')::uuid, 2027, 'AustralianSuper', current_setting('test.priv_bob_super')::uuid);

insert into public.transactions (household_id, account_id, posted_at, amount_cents, kind)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_spending')::uuid, now(), -25_00, 'expense');

-- 1. Identity vs balance now live in different surfaces. Alice's *identity*
-- surface (`public.accounts`) names shared, her own spending, Bob's spending
-- (transaction, for routing), and Bob's super (retirement stays joint) — but
-- never Bob's private saver, and it carries no balance column at all.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
do $$
declare v_hid uuid := current_setting('test.priv_hid')::uuid;
begin
  assert (select count(*) from public.accounts where household_id = v_hid) = 4,
    'Alice should see 4 account identities: shared, her spending, Bob''s spending, Bob''s super';
  assert exists (select 1 from public.accounts where id = current_setting('test.priv_shared')::uuid),
    'Alice should see the shared account identity';
  assert exists (select 1 from public.accounts where id = current_setting('test.priv_alice_spending')::uuid),
    'Alice should see her own spending account identity';
  assert exists (select 1 from public.accounts where id = current_setting('test.priv_bob_spending')::uuid),
    'Alice should see Bob''s spending identity (transaction, for routing)';
  assert exists (select 1 from public.accounts where id = current_setting('test.priv_bob_super')::uuid),
    'Alice should see Bob''s super identity (retirement stays joint)';
  assert not exists (select 1 from public.accounts where id = current_setting('test.priv_bob_saver')::uuid),
    'Alice must not see Bob''s private saver';
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'accounts' and column_name = 'balance_cents'),
    'accounts must carry no balance column after the split';
end $$;

-- 1b. Alice's *balance* surface (`accounts_with_balance` / `account_balance`) is
-- the balance-visible set: shared, her own, and Bob's super — never Bob's
-- spending or saver balance.
do $$
declare v_hid uuid := current_setting('test.priv_hid')::uuid;
begin
  assert (select count(*) from public.accounts_with_balance where household_id = v_hid) = 3,
    'Alice''s balance surface should be shared, her spending, and Bob''s super';
  assert (select count(*) from public.account_balance where household_id = v_hid) = 3,
    'Alice should read exactly 3 balances';
  assert exists (select 1 from public.accounts_with_balance where id = current_setting('test.priv_shared')::uuid),
    'Alice should see the shared balance';
  assert exists (select 1 from public.accounts_with_balance where id = current_setting('test.priv_alice_spending')::uuid),
    'Alice should see her own balance';
  assert exists (select 1 from public.accounts_with_balance where id = current_setting('test.priv_bob_super')::uuid),
    'Alice should see Bob''s super balance (retirement stays joint)';
  assert not exists (select 1 from public.account_balance where account_id = current_setting('test.priv_bob_spending')::uuid),
    'Alice must not read Bob''s spending balance';
  assert not exists (select 1 from public.account_balance where account_id = current_setting('test.priv_bob_saver')::uuid),
    'Alice must not read Bob''s saver balance';
end $$;

-- 2. Alice reads `public.transactions`: the shared-account transaction, but not
-- the one on Bob's private spending account.
do $$
declare v_hid uuid := current_setting('test.priv_hid')::uuid;
begin
  assert (select count(*) from public.transactions where household_id = v_hid) = 1,
    'Alice should see exactly the shared-account transaction';
  assert exists (select 1 from public.transactions where account_id = current_setting('test.priv_shared')::uuid),
    'Alice should see the shared-account transaction';
  assert not exists (select 1 from public.transactions where account_id = current_setting('test.priv_bob_spending')::uuid),
    'Alice must not see a transaction on Bob''s private spending account';
end $$;

-- 3. Alice reads `public.account_directory`: shared, her own, and Bob's spending
-- (transaction type, name only) — but not Bob's saver or super. The view carries
-- no balance column at all.
do $$
declare v_hid uuid := current_setting('test.priv_hid')::uuid;
begin
  assert (select count(*) from public.account_directory where household_id = v_hid) = 3,
    'Alice''s directory should list shared, her own, and Bob''s spending accounts';
  assert exists (select 1 from public.account_directory where id = current_setting('test.priv_shared')::uuid),
    'Directory should carry the shared account';
  assert exists (select 1 from public.account_directory where id = current_setting('test.priv_alice_spending')::uuid),
    'Directory should carry Alice''s own account';
  assert (select name from public.account_directory where id = current_setting('test.priv_bob_spending')::uuid) = 'Bob''s Spending',
    'Directory should name Bob''s spending account';
  assert not exists (select 1 from public.account_directory where id = current_setting('test.priv_bob_saver')::uuid),
    'Directory must not carry Bob''s private saver';
  assert not exists (select 1 from public.account_directory where id = current_setting('test.priv_bob_super')::uuid),
    'Directory must not carry Bob''s super account';
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'account_directory' and column_name = 'balance_cents'),
    'account_directory must expose no balance column';
end $$;

-- 4. Alice cannot update Bob's private spending balance: the row fails the
-- account_balance update policy's USING clause, so it is silently invisible — the
-- update matches 0 rows and update ... returning reads no balance.
do $$
declare
  v_balance bigint;
  v_count int;
begin
  update public.account_balance set balance_cents = 999_00
    where account_id = current_setting('test.priv_bob_spending')::uuid
    returning balance_cents into v_balance;
  get diagnostics v_count = row_count;
  assert v_count = 0, 'Alice''s update must match 0 of Bob''s private balances';
  assert v_balance is null, 'Alice must not read Bob''s balance via update ... returning';
end $$;

-- 5. Symmetry: acting as Bob, he cannot read Alice's private spending balance, but
-- does see the shared balance and his own balances. His balance-visible set is
-- shared, own spending, own saver, and own super.
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","email":"privacy-bob@example.com"}', true);
do $$
declare v_hid uuid := current_setting('test.priv_hid')::uuid;
begin
  assert not exists (select 1 from public.account_balance where account_id = current_setting('test.priv_alice_spending')::uuid),
    'Bob must not read Alice''s private spending balance';
  assert exists (select 1 from public.accounts_with_balance where id = current_setting('test.priv_shared')::uuid),
    'Bob should see the shared balance';
  assert exists (select 1 from public.accounts_with_balance where id = current_setting('test.priv_bob_super')::uuid),
    'Bob should see his own super balance';
  assert (select count(*) from public.accounts_with_balance where household_id = v_hid) = 4,
    'Bob''s balance-visible set: shared, own spending, own saver, own super';
  assert (select count(*) from public.account_balance where household_id = v_hid) = 4,
    'Bob should read exactly 4 balances';
end $$;

-- 6. No SECURITY DEFINER view remains anywhere in the public schema: every view
-- is security_invoker = on, so no view reads past the caller's RLS. A view with
-- the option absent or set off would reintroduce the boundary bypass the split
-- removes.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%';
  assert v_bad is null, format('views missing security_invoker=on: %s', v_bad);
end $$;

-- ── Private gift purchases within a household ────────────────────────────────
--
-- A gift's agreed budget is shared, but its purchases are hidden from the
-- recipient when the recipient is a household member. Alice budgets a gift for
-- Bob and logs a purchase: Bob sees the shared recipient/occasion/budget and its
-- budgeted amount, but never the purchase, and cannot log one for his own gift;
-- Alice (the buyer) sees the purchase. Symmetric for a gift Bob buys for Alice.

-- Both members are permanent recipients, auto-created on create_household and
-- join_household — the household has exactly those two member recipients and no
-- external ones, so Alice reuses Bob's auto-created recipient for his gift.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
do $$ begin
  assert (select count(*) from public.gift_recipient
    where household_id = current_setting('test.priv_hid')::uuid) = 2,
    'Privacy House should have exactly the two auto-created member recipients';
  assert (select count(*) from public.gift_recipient
    where household_id = current_setting('test.priv_hid')::uuid
      and member_id = current_setting('test.priv_bob_mid')::uuid) = 1,
    'Bob''s join should auto-create his gift recipient';
end $$;

select id as priv_bob_recipient from public.gift_recipient
  where household_id = current_setting('test.priv_hid')::uuid
    and member_id = current_setting('test.priv_bob_mid')::uuid \gset
select set_config('test.priv_bob_recipient', :'priv_bob_recipient', false);

insert into public.gift_occasion (household_id, name)
  values (current_setting('test.priv_hid')::uuid, 'Bob Birthday')
  returning id as priv_bob_occasion \gset
select set_config('test.priv_bob_occasion', :'priv_bob_occasion', false);

insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_recipient')::uuid, current_setting('test.priv_bob_occasion')::uuid, 200_00)
  returning id as priv_bob_gift \gset
select set_config('test.priv_bob_gift', :'priv_bob_gift', false);

insert into public.gift_purchase (household_id, gift_budget_id, amount_cents, description, purchased_on)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_gift')::uuid, 120_00, 'Watch', '2027-02-01');

-- Alice, the buyer, sees the purchase she logged for Bob's gift.
do $$ begin
  assert (select count(*) from public.gift_purchase where gift_budget_id = current_setting('test.priv_bob_gift')::uuid) = 1,
    'Alice (the buyer) should see the purchase for Bob''s gift';
end $$;

-- Bob, the recipient, sees the shared recipient/occasion/budget and its agreed
-- amount, but not the purchase.
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","email":"privacy-bob@example.com"}', true);
do $$ begin
  assert exists (select 1 from public.gift_recipient where id = current_setting('test.priv_bob_recipient')::uuid),
    'Bob should see the shared gift recipient linked to him';
  assert exists (select 1 from public.gift_occasion where id = current_setting('test.priv_bob_occasion')::uuid),
    'Bob should see the shared gift occasion';
  assert (select budgeted_amount_cents from public.gift_budget where id = current_setting('test.priv_bob_gift')::uuid) = 200_00,
    'Bob should see the shared agreed budget amount for his own gift';
  assert (select count(*) from public.gift_purchase where gift_budget_id = current_setting('test.priv_bob_gift')::uuid) = 0,
    'Bob must not see purchases logged against his own gift';
end $$;

-- Bob can edit the shared agreed budget for his own gift, and doing so still
-- reveals none of its purchases.
do $$
declare v_count int;
begin
  update public.gift_budget set budgeted_amount_cents = 250_00
    where id = current_setting('test.priv_bob_gift')::uuid;
  get diagnostics v_count = row_count;
  assert v_count = 1, 'Bob should update the agreed budget for his own gift';
  assert (select budgeted_amount_cents from public.gift_budget where id = current_setting('test.priv_bob_gift')::uuid) = 250_00,
    'Bob''s edit to his own gift''s agreed budget should persist';
  assert (select count(*) from public.gift_purchase where gift_budget_id = current_setting('test.priv_bob_gift')::uuid) = 0,
    'Editing his own gift''s budget must not reveal its purchases to Bob';
end $$;

-- Bob cannot log a purchase for his own gift (the surprise stays hidden).
do $$ begin
  insert into public.gift_purchase (household_id, gift_budget_id, amount_cents, purchased_on)
    values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_gift')::uuid, 10_00, '2027-02-02');
  raise exception 'FAIL: Bob logged a purchase for his own gift';
exception when insufficient_privilege then
  raise notice 'PASS: Bob cannot log a purchase for his own gift';
end $$;

-- Symmetry: Bob budgets a gift for Alice, reusing her auto-created recipient, and
-- logs a purchase against it.
select id as priv_alice_recipient from public.gift_recipient
  where household_id = current_setting('test.priv_hid')::uuid
    and member_id = current_setting('test.priv_alice_mid')::uuid \gset
select set_config('test.priv_alice_recipient', :'priv_alice_recipient', false);

insert into public.gift_occasion (household_id, name)
  values (current_setting('test.priv_hid')::uuid, 'Alice Birthday')
  returning id as priv_alice_occasion \gset
select set_config('test.priv_alice_occasion', :'priv_alice_occasion', false);

insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_alice_recipient')::uuid, current_setting('test.priv_alice_occasion')::uuid, 90_00)
  returning id as priv_alice_gift \gset
select set_config('test.priv_alice_gift', :'priv_alice_gift', false);

insert into public.gift_purchase (household_id, gift_budget_id, amount_cents, description, purchased_on)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_alice_gift')::uuid, 45_00, 'Perfume', '2027-03-01');

-- Bob, the buyer, sees the purchase for Alice's gift.
do $$ begin
  assert (select count(*) from public.gift_purchase where gift_budget_id = current_setting('test.priv_alice_gift')::uuid) = 1,
    'Bob (the buyer) should see the purchase for Alice''s gift';
end $$;

-- Alice sees her own gift's agreed budget but not its purchase, while still
-- seeing purchases for Bob's gift (where she is not the recipient).
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
do $$ begin
  assert (select budgeted_amount_cents from public.gift_budget where id = current_setting('test.priv_alice_gift')::uuid) = 90_00,
    'Alice should see the shared agreed budget amount for her own gift';
  assert (select count(*) from public.gift_purchase where gift_budget_id = current_setting('test.priv_alice_gift')::uuid) = 0,
    'Alice must not see purchases logged against her own gift';
  assert (select count(*) from public.gift_purchase where gift_budget_id = current_setting('test.priv_bob_gift')::uuid) = 1,
    'Alice should still see purchases for a gift where she is not the recipient';
end $$;

-- ── Household pay account: one household-level source, validated on write ─────
--
-- The pay account is set only through set_household_pay_account, which resolves
-- the caller's own household, rejects anything that is not a transaction account
-- in it, and writes households.pay_account_id (readable, household-scoped, by
-- either member). It never exposes a balance.

-- Alice designates her own spending account; both members read it.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
select public.set_household_pay_account(current_setting('test.priv_alice_spending')::uuid);
do $$ begin
  assert (select pay_account_id from public.households where id = current_setting('test.priv_hid')::uuid)
    = current_setting('test.priv_alice_spending')::uuid,
    'Alice should set the household pay account to her spending account';
end $$;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","email":"privacy-bob@example.com"}', true);
do $$ begin
  assert (select pay_account_id from public.households where id = current_setting('test.priv_hid')::uuid)
    = current_setting('test.priv_alice_spending')::uuid,
    'Bob should read the shared household pay account';
end $$;

-- The pay account is household-level: Alice can point it at Bob's spending account.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
select public.set_household_pay_account(current_setting('test.priv_bob_spending')::uuid);
do $$ begin
  assert (select pay_account_id from public.households where id = current_setting('test.priv_hid')::uuid)
    = current_setting('test.priv_bob_spending')::uuid,
    'Alice should set the pay account to a co-member''s spending account (household-level)';
end $$;

-- A non-transaction account (Bob's super, a savings account) is rejected.
do $$ begin
  perform public.set_household_pay_account(current_setting('test.priv_bob_super')::uuid);
  raise exception 'FAIL: a non-transaction account was accepted as the pay account';
exception when others then
  if sqlerrm = 'pay account must be a transaction account in the caller''s household' then
    raise notice 'PASS: non-transaction pay account rejected';
  else raise; end if;
end $$;

-- An account from another household is rejected (test.aid belongs to Alice's
-- first household, not the privacy household).
do $$ begin
  perform public.set_household_pay_account(current_setting('test.aid')::uuid);
  raise exception 'FAIL: a foreign account was accepted as the pay account';
exception when others then
  if sqlerrm = 'pay account must be a transaction account in the caller''s household' then
    raise notice 'PASS: foreign pay account rejected';
  else raise; end if;
end $$;

-- Passing null clears the designation.
select public.set_household_pay_account(null);
do $$ begin
  assert (select pay_account_id from public.households where id = current_setting('test.priv_hid')::uuid) is null,
    'a null argument should clear the household pay account';
end $$;

-- ── Gift transaction candidates: per-account privacy and household isolation ──
--
-- up-sync lands gift-category Up transactions in public.transactions, and that
-- table is the whole reason the feature reuses the ledger rather than a table of
-- its own: a candidate on a member's private spending account must stay private
-- from their co-member, while one on the joint (2Up) account is a candidate for
-- both. A dismissal is household-scoped and resolves only through the
-- transaction, so it names nothing its reader cannot already see.

-- The sync RPC is service-role-only: no client may settle a window itself.
do $$ begin
  assert not has_function_privilege('authenticated',
    'public.sync_up_gift_transactions(uuid, uuid[], timestamptz, jsonb)', 'execute'),
    'authenticated must not execute sync_up_gift_transactions';
  assert has_function_privilege('service_role',
    'public.sync_up_gift_transactions(uuid, uuid[], timestamptz, jsonb)', 'execute'),
    'service_role should execute sync_up_gift_transactions';
end $$;

-- One window for Privacy House, as up-sync settles it: a gift on the joint
-- account, one on Bob's private spending account, and one on Alice's private
-- spending account. The RPC is SECURITY DEFINER, so service_role reaches
-- `transactions` through it alone and needs no grant on the table.
reset role;
set local role service_role;
select public.sync_up_gift_transactions(
  current_setting('test.priv_hid')::uuid,
  array[
    current_setting('test.priv_shared')::uuid,
    current_setting('test.priv_bob_spending')::uuid,
    current_setting('test.priv_alice_spending')::uuid
  ],
  now() - interval '365 days',
  jsonb_build_array(
    jsonb_build_object(
      'household_id', current_setting('test.priv_hid'),
      'account_id', current_setting('test.priv_shared'),
      'member_id', null,
      'posted_at', now() - interval '2 days',
      'amount_cents', -120_00,
      'description', 'Gift shop',
      'kind', 'expense',
      'status', 'settled',
      'external_id', 'up-tx-gift-joint',
      'external_category', 'gifts-and-charity'
    ),
    jsonb_build_object(
      'household_id', current_setting('test.priv_hid'),
      'account_id', current_setting('test.priv_bob_spending'),
      'member_id', current_setting('test.priv_bob_mid'),
      'posted_at', now() - interval '3 days',
      'amount_cents', -60_00,
      'description', 'Bookshop',
      'kind', 'expense',
      'status', 'settled',
      'external_id', 'up-tx-gift-bob',
      'external_category', 'gifts-and-charity'
    ),
    jsonb_build_object(
      'household_id', current_setting('test.priv_hid'),
      'account_id', current_setting('test.priv_alice_spending'),
      'member_id', current_setting('test.priv_alice_mid'),
      'posted_at', now() - interval '4 days',
      'amount_cents', -30_00,
      'description', 'Charity donation',
      'kind', 'expense',
      'status', 'settled',
      'external_id', 'up-tx-charity-alice',
      'external_category', 'gifts-and-charity'
    )
  )
);
reset role;

select id as priv_tx_joint from public.transactions where external_id = 'up-tx-gift-joint' \gset
select set_config('test.priv_tx_joint', :'priv_tx_joint', false);
select id as priv_tx_bob from public.transactions where external_id = 'up-tx-gift-bob' \gset
select set_config('test.priv_tx_bob', :'priv_tx_bob', false);
select id as priv_tx_alice from public.transactions where external_id = 'up-tx-charity-alice' \gset
select set_config('test.priv_tx_alice', :'priv_tx_alice', false);

-- Alice reads the joint candidate and her own, never the one on Bob's private
-- spending account: the transactions policy gates on the balance-visible set, so
-- Bob's card spend stays his even though the row is in the shared household.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
do $$ begin
  assert exists (select 1 from public.transactions where id = current_setting('test.priv_tx_joint')::uuid),
    'Alice should read the gift candidate on the joint account';
  assert exists (select 1 from public.transactions where id = current_setting('test.priv_tx_alice')::uuid),
    'Alice should read the gift candidate on her own spending account';
  assert not exists (select 1 from public.transactions where id = current_setting('test.priv_tx_bob')::uuid),
    'Alice must not read a gift candidate on Bob''s private spending account';
  assert (select external_category from public.transactions
    where id = current_setting('test.priv_tx_joint')::uuid) = 'gifts-and-charity',
    'the synced candidate should carry Up''s category';
end $$;

-- Symmetry: Bob reads the joint candidate and his own, never Alice's.
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","email":"privacy-bob@example.com"}', true);
do $$ begin
  assert exists (select 1 from public.transactions where id = current_setting('test.priv_tx_joint')::uuid),
    'Bob should read the gift candidate on the joint account';
  assert exists (select 1 from public.transactions where id = current_setting('test.priv_tx_bob')::uuid),
    'Bob should read the gift candidate on his own spending account';
  assert not exists (select 1 from public.transactions where id = current_setting('test.priv_tx_alice')::uuid),
    'Bob must not read a gift candidate on Alice''s private spending account';
end $$;

-- Alice claims the joint candidate for the gift she is buying Bob, and sets the
-- charity donation aside as not a gift.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
update public.gift_purchase set transaction_id = current_setting('test.priv_tx_joint')::uuid
  where gift_budget_id = current_setting('test.priv_bob_gift')::uuid;
insert into public.gift_transaction_dismissal (household_id, transaction_id)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_tx_alice')::uuid);
do $$ begin
  assert (select count(*) from public.gift_purchase
    where transaction_id = current_setting('test.priv_tx_joint')::uuid) = 1,
    'Alice''s purchase should link the joint candidate';
  assert (select count(*) from public.gift_transaction_dismissal) = 1,
    'Alice should see the dismissal she recorded';
end $$;

-- Claiming the joint candidate withholds it from Bob: he read it a moment ago as
-- an unclaimed candidate, and the purchase behind it is hidden from him, so the
-- transactions policy drops it too — his inbox cannot offer him his own present.
-- His other transactions are untouched, and Alice, the buyer, still reads it.
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","email":"privacy-bob@example.com"}', true);
do $$ begin
  assert not exists (select 1 from public.transactions where id = current_setting('test.priv_tx_joint')::uuid),
    'Bob must not read the joint-account transaction claimed as a gift for him';
  assert exists (select 1 from public.transactions where id = current_setting('test.priv_tx_bob')::uuid),
    'withholding a claimed candidate must not affect Bob''s other transactions';
end $$;

-- Nor can he reach it through a write: the update and delete policies carry the
-- same predicate, so neither returns the withheld row.
do $$
declare v_count int;
begin
  update public.transactions set description = 'Peeked'
    where id = current_setting('test.priv_tx_joint')::uuid;
  get diagnostics v_count = row_count;
  assert v_count = 0, 'Bob must not update a transaction claimed as a gift for him';
  delete from public.transactions where id = current_setting('test.priv_tx_joint')::uuid;
  get diagnostics v_count = row_count;
  assert v_count = 0, 'Bob must not delete a transaction claimed as a gift for him';
end $$;

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
do $$ begin
  assert (select description from public.transactions
    where id = current_setting('test.priv_tx_joint')::uuid) = 'Gift shop',
    'Alice (the buyer) should still read the transaction she claimed, unaltered';
end $$;

-- Bob reads the dismissal — it is household-shared planning state — but it
-- resolves to nothing he can see: the transaction behind it is on Alice's
-- private account, so the row names no spend of hers.
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","email":"privacy-bob@example.com"}', true);
do $$ begin
  assert (select count(*) from public.gift_transaction_dismissal) = 1,
    'Bob should read his household''s dismissal';
  assert not exists (
    select 1 from public.gift_transaction_dismissal d
    join public.transactions t on t.id = d.transaction_id),
    'the dismissed transaction stays invisible to Bob through the join';
end $$;

-- Household isolation: Alice's first household sees no dismissal of Privacy
-- House's and cannot record one against its transactions.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@example.com"}', true);
do $$ begin
  assert (select count(*) from public.gift_transaction_dismissal) = 0,
    'an outside household must not see Privacy House''s dismissals';
end $$;
do $$ begin
  insert into public.gift_transaction_dismissal (household_id, transaction_id)
    values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_tx_bob')::uuid);
  raise exception 'FAIL: an outside household recorded a dismissal';
exception when insufficient_privilege then
  raise notice 'PASS: an outside household cannot record a dismissal';
end $$;

-- Referential integrity is always checked past RLS, so a member can record a
-- dismissal naming a transaction they cannot read. It discloses nothing: the row
-- carries an id and no more, and resolves to no visible transaction, so a
-- co-member's spend stays exactly as hidden as before.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
savepoint blind_dismissal;
insert into public.gift_transaction_dismissal (household_id, transaction_id)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_tx_bob')::uuid);
do $$ begin
  assert not exists (
    select 1 from public.gift_transaction_dismissal d
    join public.transactions t on t.id = d.transaction_id
    where d.transaction_id = current_setting('test.priv_tx_bob')::uuid),
    'a dismissal for an invisible transaction should resolve to nothing';
end $$;
rollback to savepoint blind_dismissal;

-- The next window reports only the joint candidate — the two private ones were
-- recategorised away in the Up app, and Up sends no event for that, which is why
-- the poll rescans the window instead of following a cursor. The prune drops
-- them, the dismissal cascades away with its transaction (out of the category it
-- is no longer a candidate to dismiss), and the claimed candidate stays and pulls
-- its purchase to the settled amount.
reset role;
set local role service_role;
select public.sync_up_gift_transactions(
  current_setting('test.priv_hid')::uuid,
  array[
    current_setting('test.priv_shared')::uuid,
    current_setting('test.priv_bob_spending')::uuid,
    current_setting('test.priv_alice_spending')::uuid
  ],
  now() - interval '365 days',
  jsonb_build_array(jsonb_build_object(
    'household_id', current_setting('test.priv_hid'),
    'account_id', current_setting('test.priv_shared'),
    'member_id', null,
    'posted_at', now() - interval '2 days',
    'amount_cents', -150_00,
    'description', 'Gift shop',
    'kind', 'expense',
    'status', 'settled',
    'external_id', 'up-tx-gift-joint',
    'external_category', 'gifts-and-charity'
  ))
);
reset role;
do $$ begin
  assert exists (select 1 from public.transactions where id = current_setting('test.priv_tx_joint')::uuid),
    'the claimed candidate should survive the prune';
  assert not exists (select 1 from public.transactions where id = current_setting('test.priv_tx_bob')::uuid),
    'a candidate Up no longer reports in the category should be pruned';
  assert not exists (select 1 from public.transactions where id = current_setting('test.priv_tx_alice')::uuid),
    'a dismissed candidate Up no longer reports should be pruned';
  assert (select count(*) from public.gift_transaction_dismissal) = 0,
    'a dismissal should cascade away with its transaction';
  assert (select amount_cents from public.gift_purchase
    where transaction_id = current_setting('test.priv_tx_joint')::uuid) = 150_00,
    'a linked purchase should follow its transaction''s settled amount';
end $$;

-- An empty window prunes what is left of it, and still keeps the claimed
-- candidate: the household has already made that transaction a purchase.
set local role service_role;
select public.sync_up_gift_transactions(
  current_setting('test.priv_hid')::uuid,
  array[current_setting('test.priv_shared')::uuid],
  now() - interval '365 days',
  '[]'::jsonb
);
reset role;
do $$ begin
  assert exists (select 1 from public.transactions where id = current_setting('test.priv_tx_joint')::uuid),
    'an empty window must not drop a claimed candidate';
end $$;
set local role authenticated;

-- Only the recipient's own gift is withheld. Three candidates on the joint
-- account — the one Alice claimed for Bob's gift, one she claims for an external
-- recipient, and one left unclaimed — sit on the account both partners see, so
-- the gift-privacy predicate is the only thing that can tell them apart.
reset role;
set local role service_role;
select public.sync_up_gift_transactions(
  current_setting('test.priv_hid')::uuid,
  array[current_setting('test.priv_shared')::uuid],
  now() - interval '365 days',
  jsonb_build_array(
    jsonb_build_object(
      'household_id', current_setting('test.priv_hid'),
      'account_id', current_setting('test.priv_shared'),
      'member_id', null,
      'posted_at', now() - interval '2 days',
      'amount_cents', -150_00,
      'description', 'Gift shop',
      'kind', 'expense',
      'status', 'settled',
      'external_id', 'up-tx-gift-joint',
      'external_category', 'gifts-and-charity'
    ),
    jsonb_build_object(
      'household_id', current_setting('test.priv_hid'),
      'account_id', current_setting('test.priv_shared'),
      'member_id', null,
      'posted_at', now() - interval '5 days',
      'amount_cents', -80_00,
      'description', 'Florist',
      'kind', 'expense',
      'status', 'settled',
      'external_id', 'up-tx-gift-joint-mum',
      'external_category', 'gifts-and-charity'
    ),
    jsonb_build_object(
      'household_id', current_setting('test.priv_hid'),
      'account_id', current_setting('test.priv_shared'),
      'member_id', null,
      'posted_at', now() - interval '6 days',
      'amount_cents', -25_00,
      'description', 'Card shop',
      'kind', 'expense',
      'status', 'settled',
      'external_id', 'up-tx-gift-joint-open',
      'external_category', 'gifts-and-charity'
    )
  )
);
reset role;

select id as priv_tx_mum from public.transactions where external_id = 'up-tx-gift-joint-mum' \gset
select set_config('test.priv_tx_mum', :'priv_tx_mum', false);
select id as priv_tx_open from public.transactions where external_id = 'up-tx-gift-joint-open' \gset
select set_config('test.priv_tx_open', :'priv_tx_open', false);

-- Alice budgets a gift for Mum — an external recipient, so nothing about it is
-- private — and claims the florist candidate for it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
insert into public.gift_recipient (household_id, name)
  values (current_setting('test.priv_hid')::uuid, 'Mum')
  returning id as priv_mum_recipient \gset
select set_config('test.priv_mum_recipient', :'priv_mum_recipient', false);

insert into public.gift_occasion (household_id, name)
  values (current_setting('test.priv_hid')::uuid, 'Mum Birthday')
  returning id as priv_mum_occasion \gset
select set_config('test.priv_mum_occasion', :'priv_mum_occasion', false);

insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_mum_recipient')::uuid, current_setting('test.priv_mum_occasion')::uuid, 100_00)
  returning id as priv_mum_gift \gset
select set_config('test.priv_mum_gift', :'priv_mum_gift', false);

insert into public.gift_purchase
    (household_id, gift_budget_id, transaction_id, amount_cents, description, purchased_on)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_mum_gift')::uuid,
    current_setting('test.priv_tx_mum')::uuid, 80_00, 'Flowers', '2027-04-01');

-- Alice, the buyer of both, reads all three.
do $$ begin
  assert (select count(*) from public.transactions where id in (
    current_setting('test.priv_tx_joint')::uuid,
    current_setting('test.priv_tx_mum')::uuid,
    current_setting('test.priv_tx_open')::uuid)) = 3,
    'Alice should read every joint-account candidate';
end $$;

-- Bob reads the two that are not his surprise: a candidate claimed for an
-- external recipient stays shared (purchase included), an unclaimed one is a
-- candidate for both, and only the one claimed as his own gift is withheld.
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","email":"privacy-bob@example.com"}', true);
do $$ begin
  assert exists (select 1 from public.transactions where id = current_setting('test.priv_tx_mum')::uuid),
    'a joint-account candidate claimed for an external recipient stays visible to Bob';
  assert (select count(*) from public.gift_purchase
    where transaction_id = current_setting('test.priv_tx_mum')::uuid) = 1,
    'the purchase for an external recipient stays shared with Bob';
  assert exists (select 1 from public.transactions where id = current_setting('test.priv_tx_open')::uuid),
    'an unclaimed joint-account candidate stays visible to Bob';
  assert not exists (select 1 from public.transactions where id = current_setting('test.priv_tx_joint')::uuid),
    'the joint-account candidate claimed as Bob''s gift stays withheld from Bob';
end $$;

-- ── Web Push subscriptions: a member manages only their own devices ───────────
--
-- A subscription endpoint is a bearer capability to push to someone's phone, so
-- unlike the household's shared planning data it is scoped to the one member
-- whose device it is: household membership alone grants neither read nor delete.
-- The endpoint is also globally unique, so a re-subscribing device upserts on it.

-- Alice opts in two devices of her own.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
insert into public.push_subscription (household_id, member_id, endpoint, p256dh, auth)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_alice_mid')::uuid,
    'https://push.example/alice-phone', 'alice-phone-p256dh', 'alice-phone-auth')
  returning id as priv_alice_device \gset
select set_config('test.priv_alice_device', :'priv_alice_device', false);

insert into public.push_subscription (household_id, member_id, endpoint, p256dh, auth)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_alice_mid')::uuid,
    'https://push.example/alice-laptop', 'alice-laptop-p256dh', 'alice-laptop-auth');

do $$ begin
  assert (select count(*) from public.push_subscription) = 2,
    'Alice should read both of her own devices';
end $$;

-- Re-subscribing the same device refreshes its keys in place: the unique
-- endpoint makes `on conflict (endpoint)` inferable, so no duplicate lands.
insert into public.push_subscription (household_id, member_id, endpoint, p256dh, auth)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_alice_mid')::uuid,
    'https://push.example/alice-phone', 'rotated-p256dh', 'rotated-auth')
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth;

do $$ begin
  assert (select count(*) from public.push_subscription) = 2,
    'a re-subscribe should upsert on the endpoint, not duplicate the device';
  assert (select p256dh from public.push_subscription
    where id = current_setting('test.priv_alice_device')::uuid) = 'rotated-p256dh',
    'a re-subscribe should refresh the stored keys';
end $$;

-- Alice cannot attribute a device to her co-member.
do $$ begin
  insert into public.push_subscription (household_id, member_id, endpoint, p256dh, auth)
    values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_mid')::uuid,
      'https://push.example/forged', 'x', 'y');
  raise exception 'FAIL: Alice registered a device for her co-member';
exception when insufficient_privilege then
  raise notice 'PASS: a member cannot register a device for a co-member';
end $$;

-- Bob, a member of the same household, sees and can delete only his own devices.
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","email":"privacy-bob@example.com"}', true);
insert into public.push_subscription (household_id, member_id, endpoint, p256dh, auth)
  values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_mid')::uuid,
    'https://push.example/bob-phone', 'bob-phone-p256dh', 'bob-phone-auth');

do $$ begin
  assert (select count(*) from public.push_subscription) = 1,
    'Bob should see only his own device, never a co-member''s';
  assert not exists (select 1 from public.push_subscription
    where id = current_setting('test.priv_alice_device')::uuid),
    'a co-member''s subscription endpoint must not be readable';
end $$;

-- His delete of her device matches no row rather than erroring, so the row
-- survives (checked below, as Alice, since Bob cannot read it to confirm).
delete from public.push_subscription where id = current_setting('test.priv_alice_device')::uuid;

-- Nor can Bob take the device over by upserting on its endpoint: the update
-- policy is gated on the existing row's member.
do $$ begin
  insert into public.push_subscription (household_id, member_id, endpoint, p256dh, auth)
    values (current_setting('test.priv_hid')::uuid, current_setting('test.priv_bob_mid')::uuid,
      'https://push.example/alice-phone', 'stolen-p256dh', 'stolen-auth')
    on conflict (endpoint) do update
      set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth;
  raise exception 'FAIL: Bob took over a co-member''s device by upserting its endpoint';
exception when insufficient_privilege then
  raise notice 'PASS: a member cannot reassign a co-member''s device';
end $$;

-- A member of another household sees and deletes nothing at all.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@example.com"}', true);
do $$ begin
  assert (select count(*) from public.push_subscription) = 0,
    'an outside household must not see Privacy House''s devices';
end $$;
delete from public.push_subscription where id = current_setting('test.priv_alice_device')::uuid;

-- Back as Alice: neither delete attempt touched her device, and her own delete
-- (the opt-out path) does.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","email":"privacy-alice@example.com"}', true);
do $$ begin
  assert exists (select 1 from public.push_subscription
    where id = current_setting('test.priv_alice_device')::uuid),
    'neither a co-member nor an outside household should delete Alice''s device';
  assert (select p256dh from public.push_subscription
    where id = current_setting('test.priv_alice_device')::uuid) = 'rotated-p256dh',
    'the blocked takeover should leave Alice''s keys untouched';
end $$;

delete from public.push_subscription where id = current_setting('test.priv_alice_device')::uuid;
do $$ begin
  assert (select count(*) from public.push_subscription) = 1,
    'Alice should delete her own device and keep her remaining one';
end $$;

-- The VAPID credential set is service-role-only: a member cannot read the keys
-- that authorise a push, even though its own subscriptions are hers to manage.
do $$ begin
  perform public.vapid_keys();
  raise exception 'FAIL: a member read the VAPID credential set';
exception when insufficient_privilege then
  raise notice 'PASS: vapid_keys is not executable by a member';
end $$;

rollback;
