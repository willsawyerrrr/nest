-- Assertions for the per-member spending allowance and budget lines drawn from it.
--
-- `member_allowance` carries the household-wide policy of the other planning
-- tables and is held to one row per member, a positive amount, and the budget
-- line cadence rule. `budget_line.allowance_member_id` draws a manual
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

insert into public.member_allowance (household_id, member_id, amount_cents, frequency)
  values (current_setting('allow.hid')::uuid, current_setting('allow.mid')::uuid, 200_00, 'fortnightly');

do $$ begin
  assert (select count(*) from public.member_allowance) = 1, 'Alice should see her allowance';
  assert (select interval_count from public.member_allowance) is null,
    'a fixed frequency carries no interval count';
end $$;

-- One allowance per member.
do $$ begin
  insert into public.member_allowance (household_id, member_id, amount_cents, frequency)
    values (current_setting('allow.hid')::uuid, current_setting('allow.mid')::uuid, 50_00, 'weekly');
  raise exception 'FAIL: a second allowance for the same member was accepted';
exception when unique_violation then
  raise notice 'PASS: one allowance per member';
end $$;

-- The amount must be positive.
do $$ begin
  update public.member_allowance set amount_cents = 0;
  raise exception 'FAIL: a non-positive allowance was accepted';
exception when check_violation then
  raise notice 'PASS: an allowance amount must be positive';
end $$;

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
  assert (select count(*) from public.member_allowance) = 0, 'Bob must not see Alice''s allowance';
end $$;

do $$ begin
  insert into public.member_allowance (household_id, member_id, amount_cents, frequency)
    values (current_setting('allow.hid')::uuid, current_setting('allow.bmid')::uuid, 1_00, 'weekly');
  raise exception 'FAIL: Bob inserted an allowance into Alice''s household';
exception when insufficient_privilege then
  raise notice 'PASS: Bob blocked from inserting into Alice''s household';
end $$;

-- A household cannot reference another household's member.
do $$ begin
  insert into public.member_allowance (household_id, member_id, amount_cents, frequency)
    values (current_setting('allow.hid2')::uuid, current_setting('allow.mid')::uuid, 1_00, 'weekly');
  raise exception 'FAIL: Bob set an allowance for Alice''s member';
exception when foreign_key_violation then
  raise notice 'PASS: an allowance cannot reference another household''s member';
end $$;

-- ── Carol joins Alice's household and manages the shared allowance ───────────

select set_config('request.jwt.claims', '{"sub":"32000000-0000-0000-0000-000000000001","email":"allow-alice@example.com"}', true);
select invite_code as code from public.create_invite_code() \gset
select set_config('allow.code', :'code', false);

select set_config('request.jwt.claims', '{"sub":"32000000-0000-0000-0000-000000000003","email":"allow-carol@example.com"}', true);
select public.join_household(current_setting('allow.code'), 'Carol');

do $$ begin
  assert (select count(*) from public.member_allowance) = 1,
    'Carol should see Alice''s allowance — it is a shared envelope, not a privacy boundary';
end $$;
update public.member_allowance set amount_cents = 250_00;
do $$ begin
  assert (select amount_cents from public.member_allowance) = 250_00,
    'any household member may edit an allowance';
end $$;

-- Deleting the allowance releases its lines to ordinary Discretionary items.
delete from public.member_allowance;
do $$ begin
  assert (select allowance_member_id from public.budget_line where name = 'Gym') is null,
    'deleting an allowance should release the lines drawn from it';
  assert (select line_group from public.budget_line where name = 'Gym') = 'discretionary',
    'a released line stays a Discretionary item';
end $$;

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
