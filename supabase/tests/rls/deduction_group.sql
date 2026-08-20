-- Assertions for grouping a member's deductions.
--
-- A recurring deductible expense is many payments of one commitment, each
-- already a deduction in its own right. `deduction_group` names the set and
-- `deduction.group_id` puts a payment in it; the composite reference carries
-- household, member, and financial year, so a payment cannot join a group
-- belonging to another member or another year. Dropping a group ungroups its
-- payments rather than deleting them.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'groups@example.com'),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'groups-partner@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000005","email":"groups@example.com"}', true);
select public.create_household('Subscribers', 'Robin') as db_hid \gset
select set_config('db.hid', :'db_hid', false);
select id as db_mid from public.members where household_id = current_setting('db.hid')::uuid \gset
select set_config('db.mid', :'db_mid', false);

insert into public.deduction_group (household_id, member_id, name, financial_year)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Adobe Creative Cloud', 2027)
  returning id as db_gid \gset
select set_config('db.gid', :'db_gid', false);

-- Two payments of the one expense, in the group's own year.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, group_id)
  values
    (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Adobe Creative Cloud', 64_99, '2026-07-01', 2027, current_setting('db.gid')::uuid),
    (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Adobe Creative Cloud', 64_99, '2026-08-01', 2027, current_setting('db.gid')::uuid);

do $$
declare v_gid uuid := current_setting('db.gid')::uuid;
begin
  assert (select count(*) from public.deduction where group_id = v_gid) = 2,
    'both payments should sit in the group';
  assert (select sum(amount_cents) from public.deduction where group_id = v_gid) = 129_98,
    'the group total should be the sum of its payments';
end $$;

-- A payment in another financial year cannot join a FY2027 group: the group
-- total is meant to BE the figure claimed for its year.
do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
        v_mid uuid := current_setting('db.mid')::uuid;
        v_gid uuid := current_setting('db.gid')::uuid;
begin
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, group_id)
      values (v_hid, v_mid, 'Adobe Creative Cloud', 64_99, '2027-07-01', 2028, v_gid);
    assert false, 'a payment from another financial year should not join the group';
  exception when foreign_key_violation then
    null;
  end;
end $$;

-- A second member's payment cannot join the first member's group. The partner
-- joins the way the app has them join: a single-use invite code, redeemed under
-- their own auth user.
select invite_code as code from public.create_invite_code() \gset
select set_config('db.code', :'code', false);

select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000006","email":"groups-partner@example.com"}', true);
select public.join_household(current_setting('db.code'), 'Sam');
select id as db_mid2 from public.members
  where household_id = current_setting('db.hid')::uuid
    and id <> current_setting('db.mid')::uuid \gset
select set_config('db.mid2', :'db_mid2', false);

select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000005","email":"groups@example.com"}', true);

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
        v_mid2 uuid := current_setting('db.mid2')::uuid;
        v_gid uuid := current_setting('db.gid')::uuid;
begin
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, group_id)
      values (v_hid, v_mid2, 'Adobe Creative Cloud', 64_99, '2026-09-01', 2027, v_gid);
    assert false, 'another member''s payment should not join this member''s group';
  exception when foreign_key_violation then
    null;
  end;
end $$;

-- The add path files its payment in the group. Adding a deduction goes through
-- `create_deduction_with_receipts`, which names its columns explicitly, so the
-- group has to be among them — a payload the function ignores is a payment that
-- silently lands ungrouped.
select public.create_deduction_with_receipts(
  jsonb_build_object(
    'household_id', current_setting('db.hid')::uuid,
    'member_id', current_setting('db.mid')::uuid,
    'description', 'Adobe Creative Cloud',
    'amount_cents', 64_99,
    'deduction_date', '2026-10-01',
    'financial_year', 2027,
    'group_id', current_setting('db.gid')::uuid
  ),
  '[]'::jsonb
) as db_added \gset
select set_config('db.added', :'db_added', false);

do $$
declare v_added uuid := current_setting('db.added')::uuid;
begin
  assert (select group_id from public.deduction where id = v_added)
    = current_setting('db.gid')::uuid,
    'a payment added through the RPC should land in the group it names';
end $$;

-- Ungrouping is not deleting: dropping the group leaves the payments standing.
delete from public.deduction_group where id = current_setting('db.gid')::uuid;

do $$
begin
  assert (select count(*) from public.deduction where description = 'Adobe Creative Cloud') = 3,
    'dropping a group should leave its payments as ordinary deductions';
  assert not exists (select 1 from public.deduction where group_id is not null),
    'dropping a group should clear its payments'' group_id and nothing else';
  assert (select count(*) from public.deduction where financial_year = 2027) = 3,
    'ungrouping should not disturb the payments'' own columns';
end $$;

rollback;
