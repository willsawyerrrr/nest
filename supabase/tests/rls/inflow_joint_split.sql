-- Assertions for a joint inflow's split columns.
--
-- `is_joint` marks a recurring taxable `other` inflow both partners are assessed
-- on, and `member_split_percent` is the whole-number share (0–100) assessed to
-- `member_id`, with the household's other member taking the remainder. The
-- `inflows_joint_split` check constraint confines `is_joint` to that one shape
-- and holds `member_split_percent` non-null exactly when `is_joint`, mirroring
-- `inflows_one_off_shape`. RLS is unchanged — the household-wide inflow policy
-- already covers these columns — so this file exercises the constraint alone.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'joint-ada@example.com'),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'joint-ben@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","email":"joint-ada@example.com"}', true);
select public.create_household('Joint Household', 'Ada') as hid \gset
select set_config('jt.hid', :'hid', false);
select invite_code as code from public.create_invite_code() \gset
select set_config('jt.code', :'code', false);

select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000002","email":"joint-ben@example.com"}', true);
select public.join_household(current_setting('jt.code'), 'Ben');

select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","email":"joint-ada@example.com"}', true);
select id as mid from public.members
  where household_id = current_setting('jt.hid')::uuid and user_id = '70000000-0000-0000-0000-000000000001' \gset
select set_config('jt.mid', :'mid', false);

do $$ begin
  assert exists (
    select 1 from pg_constraint
    where conname = 'inflows_joint_split' and conrelid = 'public.inflows'::regclass),
    'the joint-split constraint should hold each column to its shape';
end $$;

-- A plain inflow defaults to not-joint with no split percent.
insert into public.inflows (household_id, member_id, name, taxable, type, schedule, amount_cents)
  values (current_setting('jt.hid')::uuid, current_setting('jt.mid')::uuid, 'Salary', true, 'salary', 'annual', 120_000_00)
  returning id as plain \gset
select set_config('jt.plain', :'plain', false);

do $$
declare v_id uuid := current_setting('jt.plain')::uuid;
begin
  assert (select is_joint from public.inflows where id = v_id) = false,
    'an inflow written without is_joint defaults to false';
  assert (select member_split_percent from public.inflows where id = v_id) is null,
    'a non-joint inflow carries no split percent';
end $$;

-- A recurring taxable `other` inflow can be joint with a percent in range,
-- including the 0 and 100 bounds.
insert into public.inflows (household_id, member_id, name, taxable, type, schedule, amount_cents, is_joint, member_split_percent)
  values (current_setting('jt.hid')::uuid, current_setting('jt.mid')::uuid, 'Joint rental', true, 'other', 'annual', 24_000_00, true, 70);
insert into public.inflows (household_id, member_id, name, taxable, type, schedule, amount_cents, is_joint, member_split_percent)
  values (current_setting('jt.hid')::uuid, current_setting('jt.mid')::uuid, 'All to me', true, 'other', 'annual', 1_000_00, true, 100);
insert into public.inflows (household_id, member_id, name, taxable, type, schedule, amount_cents, is_joint, member_split_percent)
  values (current_setting('jt.hid')::uuid, current_setting('jt.mid')::uuid, 'All to them', true, 'other', 'annual', 1_000_00, true, 0);

do $$ begin
  assert (select member_split_percent from public.inflows where name = 'Joint rental') = 70,
    'the split percent should round-trip';
end $$;

do $$
declare
  v_hid uuid := current_setting('jt.hid')::uuid;
  v_mid uuid := current_setting('jt.mid')::uuid;
begin
  -- A split percent without is_joint.
  begin
    insert into public.inflows (household_id, member_id, name, taxable, type, schedule, amount_cents, member_split_percent)
      values (v_hid, v_mid, 'Not joint', true, 'other', 'annual', 1_000_00, 50);
    raise exception 'FAIL: member_split_percent was saved on a non-joint inflow';
  exception when check_violation then
    raise notice 'PASS: member_split_percent is null unless is_joint';
  end;

  -- is_joint with no split percent.
  begin
    insert into public.inflows (household_id, member_id, name, taxable, type, schedule, amount_cents, is_joint)
      values (v_hid, v_mid, 'Joint, no percent', true, 'other', 'annual', 1_000_00, true);
    raise exception 'FAIL: a joint inflow was saved with no split percent';
  exception when check_violation then
    raise notice 'PASS: a joint inflow must name a split percent';
  end;

  -- Percent out of range.
  begin
    insert into public.inflows (household_id, member_id, name, taxable, type, schedule, amount_cents, is_joint, member_split_percent)
      values (v_hid, v_mid, 'Over 100', true, 'other', 'annual', 1_000_00, true, 150);
    raise exception 'FAIL: a split percent above 100 was saved';
  exception when check_violation then
    raise notice 'PASS: the split percent cannot exceed 100';
  end;

  -- A salary cannot be joint.
  begin
    insert into public.inflows (household_id, member_id, name, taxable, type, schedule, amount_cents, is_joint, member_split_percent)
      values (v_hid, v_mid, 'Joint salary', true, 'salary', 'annual', 1_000_00, true, 50);
    raise exception 'FAIL: a salary was marked joint';
  exception when check_violation then
    raise notice 'PASS: only an `other` inflow can be joint';
  end;

  -- A one-off cannot be joint.
  begin
    insert into public.inflows (household_id, member_id, name, taxable, type, paid_on, one_off_tax_treatment, amount_cents, is_joint, member_split_percent)
      values (v_hid, v_mid, 'Joint one-off', true, 'other', '2026-09-12', 'ordinary', 1_000_00, true, 50);
    raise exception 'FAIL: a one-off was marked joint';
  exception when check_violation then
    raise notice 'PASS: a one-off cannot be joint';
  end;
end $$;

rollback;
