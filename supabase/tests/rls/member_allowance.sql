-- Assertions for the per-member spending allowance and budget lines drawn from it.
--
-- `member_allowance` is permanent: created with its member, never deleted, and
-- editable only in amount, cadence, and funding account. It carries the
-- household-wide read/edit policy of the other planning tables and is held to one
-- row per member, a non-negative amount, and the budget line cadence rule. `budget_line.allowance_member_id` draws a manual
-- Discretionary line from a member's allowance through a composite foreign key;
-- deleting the allowance releases its lines, and `commit_planning_changes` carries
-- the column.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '32000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'allow-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '32000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'allow-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '32000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'allow-carol@example.com');

-- ── Alice's household ────────────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"32000000-0000-0000-0000-000000000001","email":"allow-alice@example.com"}', true);
select public.create_household('Alice Household', 'Alice') as hid \gset
select set_config('allow.hid', :'hid', false);
select id as mid from public.members where household_id = current_setting('allow.hid')::uuid \gset
select set_config('allow.mid', :'mid', false);

-- A member's allowance is created with the member, at zero.
do $$ begin
  assert (select count(*) from public.member_allowance) = 1, 'Alice should see her allowance';
  assert (select amount_cents from public.member_allowance) = 0, 'a new allowance starts at zero';
end $$;

-- It cannot be created by hand, even for the member who has none.
do $$ begin
  insert into public.member_allowance (household_id, member_id, amount_cents, frequency)
    values (current_setting('allow.hid')::uuid, current_setting('allow.mid')::uuid, 50_00, 'weekly');
  raise exception 'FAIL: an authenticated user inserted an allowance';
exception when insufficient_privilege then
  raise notice 'PASS: an allowance cannot be inserted by hand';
end $$;

-- Amount, cadence, and funding account are editable.
update public.member_allowance set amount_cents = 200_00, frequency = 'fortnightly';

do $$ begin
  assert (select interval_count from public.member_allowance) is null,
    'a fixed frequency carries no interval count';
end $$;

-- One allowance per member, even against the owner role.
reset role;
do $$ begin
  insert into public.member_allowance (household_id, member_id, amount_cents, frequency)
    values (current_setting('allow.hid')::uuid, current_setting('allow.mid')::uuid, 50_00, 'weekly');
  raise exception 'FAIL: a second allowance for the same member was accepted';
exception when unique_violation then
  raise notice 'PASS: one allowance per member';
end $$;
set local role authenticated;

-- The amount cannot be negative, but zero is an unset allowance.
do $$ begin
  update public.member_allowance set amount_cents = -1;
  raise exception 'FAIL: a negative allowance was accepted';
exception when check_violation then
  raise notice 'PASS: an allowance amount cannot be negative';
end $$;
update public.member_allowance set amount_cents = 0;
update public.member_allowance set amount_cents = 200_00;

-- Its member and household are fixed.
do $$ begin
  update public.member_allowance set member_id = gen_random_uuid();
  raise exception 'FAIL: an allowance was reassigned to another member';
exception when insufficient_privilege then
  raise notice 'PASS: an allowance''s member cannot be updated';
end $$;
do $$ begin
  update public.member_allowance set household_id = gen_random_uuid();
  raise exception 'FAIL: an allowance was moved to another household';
exception when insufficient_privilege then
  raise notice 'PASS: an allowance''s household cannot be updated';
end $$;
reset role;
do $$ begin
  update public.member_allowance set member_id = gen_random_uuid();
  raise exception 'FAIL: the owner reassigned an allowance';
exception when check_violation then
  raise notice 'PASS: even the owner cannot reassign an allowance';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"32000000-0000-0000-0000-000000000001","email":"allow-alice@example.com"}', true);

-- It cannot be deleted, by a member or by the owner role.
do $$ begin
  delete from public.member_allowance;
  raise exception 'FAIL: a member deleted an allowance';
exception when insufficient_privilege then
  raise notice 'PASS: a member cannot delete an allowance';
end $$;
reset role;
do $$ begin
  delete from public.member_allowance;
  raise exception 'FAIL: the owner deleted an allowance';
exception when check_violation then
  raise notice 'PASS: even the owner cannot delete an allowance';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"32000000-0000-0000-0000-000000000001","email":"allow-alice@example.com"}', true);

-- The interval count follows the frequency, as on a budget line.
do $$ begin
  update public.member_allowance set frequency = 'every_n_weeks';
  raise exception 'FAIL: an every-N-weeks allowance without an interval was accepted';
exception when check_violation then
  raise notice 'PASS: every-N cadence requires an interval count';
end $$;
do $$ begin
  update public.member_allowance set interval_count = 3;
  raise exception 'FAIL: an interval count on a fixed frequency was accepted';
exception when check_violation then
  raise notice 'PASS: a fixed frequency forbids an interval count';
end $$;
update public.member_allowance set frequency = 'every_n_weeks', interval_count = 3;
update public.member_allowance set frequency = 'fortnightly', interval_count = null;

-- ── Drawing budget lines from the allowance ──────────────────────────────────

insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id)
  values (current_setting('allow.hid')::uuid, 'discretionary', 'Gym', 40_00, 'fortnightly', current_setting('allow.mid')::uuid);

do $$ begin
  assert (select allowance_member_id from public.budget_line where name = 'Gym') = current_setting('allow.mid')::uuid,
    'a Discretionary line may be drawn from the allowance';
end $$;

-- Only a Discretionary line may be drawn.
do $$ begin
  insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id)
    values (current_setting('allow.hid')::uuid, 'wants', 'Streaming', 20_00, 'monthly', current_setting('allow.mid')::uuid);
  raise exception 'FAIL: a Wants line was drawn from the allowance';
exception when check_violation then
  raise notice 'PASS: only a Discretionary line may be drawn';
end $$;

-- A drawn line carries no destination of its own.
do $$
declare v_account uuid;
begin
  insert into public.accounts (household_id, name, type, source)
    values (current_setting('allow.hid')::uuid, 'Everyday', 'transaction', 'manual')
    returning id into v_account;
  insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id, destination_account_id)
    values (current_setting('allow.hid')::uuid, 'discretionary', 'Routed', 20_00, 'monthly', current_setting('allow.mid')::uuid, v_account);
  raise exception 'FAIL: a drawn line with its own destination was accepted';
exception when check_violation then
  raise notice 'PASS: a drawn line carries no destination of its own';
end $$;

-- A gift line cannot be drawn.
do $$ begin
  insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id, is_gift_line)
    values (current_setting('allow.hid')::uuid, 'discretionary', 'Gifts', 20_00, 'annual', current_setting('allow.mid')::uuid, true);
  raise exception 'FAIL: a derived gift line was drawn from the allowance';
exception when check_violation then
  raise notice 'PASS: a derived line cannot be drawn';
end $$;

-- A line cannot move out of Discretionary while drawn.
do $$ begin
  update public.budget_line set line_group = 'wants' where name = 'Gym';
  raise exception 'FAIL: a drawn line moved out of Discretionary';
exception when check_violation then
  raise notice 'PASS: a drawn line cannot leave Discretionary';
end $$;

-- A line cannot be drawn from a member who has no allowance.
do $$ begin
  insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id)
    values (current_setting('allow.hid')::uuid, 'discretionary', 'Ghost', 20_00, 'monthly', gen_random_uuid());
  raise exception 'FAIL: a line was drawn from a nonexistent allowance';
exception when foreign_key_violation then
  raise notice 'PASS: a line must be drawn from an existing allowance';
end $$;

-- commit_planning_changes carries the column on a create and an update.
do $$
declare v_id uuid := gen_random_uuid();
begin
  perform public.commit_planning_changes(
    p_budget_line_creates := jsonb_build_array(jsonb_build_object(
      'id', v_id, 'household_id', current_setting('allow.hid'),
      'line_group', 'discretionary', 'name', 'Coffee', 'amount_cents', 10_00, 'frequency', 'weekly',
      'allowance_member_id', current_setting('allow.mid')
    ))
  );
  assert (select allowance_member_id from public.budget_line where id = v_id) = current_setting('allow.mid')::uuid,
    'a created budget line should carry the allowance it draws from';

  perform public.commit_planning_changes(
    p_budget_line_updates := jsonb_build_object(v_id::text, jsonb_build_object('amount_cents', 12_00))
  );
  assert (select allowance_member_id from public.budget_line where id = v_id) = current_setting('allow.mid')::uuid,
    'a patch not naming the allowance should leave it as stored';

  perform public.commit_planning_changes(
    p_budget_line_updates := jsonb_build_object(v_id::text, jsonb_build_object('allowance_member_id', null))
  );
  assert (select allowance_member_id from public.budget_line where id = v_id) is null,
    'a patch setting the allowance to null should release the line';
end $$;

-- ── Bob's separate household is isolated ─────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"32000000-0000-0000-0000-000000000002","email":"allow-bob@example.com"}', true);
select public.create_household('Bob Household', 'Bob') as hid2 \gset
select set_config('allow.hid2', :'hid2', false);
select id as bmid from public.members where household_id = current_setting('allow.hid2')::uuid \gset
select set_config('allow.bmid', :'bmid', false);

do $$ begin
  assert (select count(*) from public.member_allowance) = 1
    and (select household_id from public.member_allowance) = current_setting('allow.hid2')::uuid,
    'Bob must see only his own household''s allowance';
end $$;

-- Bob's edit of Alice's allowance matches nothing.
update public.member_allowance set amount_cents = 1_00 where member_id = current_setting('allow.mid')::uuid;
reset role;
do $$ begin
  assert (select amount_cents from public.member_allowance where member_id = current_setting('allow.mid')::uuid) = 200_00,
    'Bob must not edit Alice''s allowance';
  assert (select count(*) from public.member_allowance where household_id = current_setting('allow.hid2')::uuid) = 1,
    'Bob''s own member has an allowance';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"32000000-0000-0000-0000-000000000002","email":"allow-bob@example.com"}', true);

-- ── Carol joins Alice's household and manages the shared allowance ───────────

select set_config('request.jwt.claims', '{"sub":"32000000-0000-0000-0000-000000000001","email":"allow-alice@example.com"}', true);
select invite_code as code from public.create_invite_code() \gset
select set_config('allow.code', :'code', false);

select set_config('request.jwt.claims', '{"sub":"32000000-0000-0000-0000-000000000003","email":"allow-carol@example.com"}', true);
select public.join_household(current_setting('allow.code'), 'Carol');

do $$ begin
  assert exists (select 1 from public.member_allowance where member_id = current_setting('allow.mid')::uuid),
    'Carol should see Alice''s allowance — it is a shared envelope, not a privacy boundary';
end $$;
update public.member_allowance set amount_cents = 250_00 where member_id = current_setting('allow.mid')::uuid;
do $$ begin
  assert (select amount_cents from public.member_allowance where member_id = current_setting('allow.mid')::uuid) = 250_00,
    'any household member may edit an allowance';
end $$;

-- Joining creates the joiner's allowance, so every member has exactly one.
do $$ begin
  assert (select count(*) from public.member_allowance) = 2,
    'a member who joins gets an allowance';
end $$;

-- Deleting the member removes their allowance and releases its lines.
reset role;
insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id)
  select household_id, 'discretionary', 'Carol coffee', 5_00, 'weekly', member_id
  from public.member_allowance
  where household_id = current_setting('allow.hid')::uuid and member_id <> current_setting('allow.mid')::uuid;
delete from public.members where id <> current_setting('allow.mid')::uuid and household_id = current_setting('allow.hid')::uuid;
do $$ begin
  assert (select count(*) from public.member_allowance where household_id = current_setting('allow.hid')::uuid) = 1,
    'deleting a member should remove their allowance';
  assert (select allowance_member_id from public.budget_line where name = 'Carol coffee') is null,
    'removing an allowance should release the lines drawn from it';
  assert (select line_group from public.budget_line where name = 'Carol coffee') = 'discretionary',
    'a released line stays a Discretionary item';
end $$;

-- Deleting the household removes its allowances despite the delete guard.
delete from public.households where id = current_setting('allow.hid2')::uuid;
do $$ begin
  assert (select count(*) from public.member_allowance where household_id = current_setting('allow.hid2')::uuid) = 0,
    'deleting a household should remove its allowances';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"32000000-0000-0000-0000-000000000001","email":"allow-alice@example.com"}', true);

-- ── service_role reads allowances for the household buffer, and cannot write ──

reset role;
do $$ begin
  assert has_table_privilege('service_role', 'public.member_allowance', 'select'),
    'service_role should select member_allowance (the buffer loader reads it)';
  assert not has_table_privilege('service_role', 'public.member_allowance', 'insert')
    and not has_table_privilege('service_role', 'public.member_allowance', 'update')
    and not has_table_privilege('service_role', 'public.member_allowance', 'delete'),
    'service_role must not write member_allowance';
end $$;

rollback;
