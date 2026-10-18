-- Assertions that a member's allowance can never be overdrawn: drawing a budget
-- line (insert, update, or `commit_planning_changes`) or lowering the allowance is
-- refused with `allowance_overdrawn` when the annualised drawn total would exceed
-- the allowance. Totals compare on annual cents across cadences, a zero allowance
-- admits nothing, trimming a line is always allowed, and a co-member is held to
-- the same limit without seeing the lines.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '34000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'over-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '34000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'over-bob@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"34000000-0000-0000-0000-000000000001","email":"over-alice@example.com"}', true);
select public.create_household('Overdraw Household', 'Alice') as hid \gset
select set_config('over.hid', :'hid', false);
select id as amid from public.members where household_id = :'hid'::uuid \gset
select set_config('over.amid', :'amid', false);
select invite_code as code from public.create_invite_code() \gset
select set_config('request.jwt.claims', '{"sub":"34000000-0000-0000-0000-000000000002","email":"over-bob@example.com"}', true);
select public.join_household(:'code', 'Bob');
select set_config('request.jwt.claims', '{"sub":"34000000-0000-0000-0000-000000000001","email":"over-alice@example.com"}', true);

-- A zero allowance admits nothing.
do $$ begin
  insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id)
    values (current_setting('over.hid')::uuid, 'discretionary', 'Zero', 1, 'annual', current_setting('over.amid')::uuid);
  raise exception 'FAIL: a line was drawn from a zero allowance';
exception when check_violation then
  assert sqlerrm = 'allowance_overdrawn', 'the refusal must be the fixed allowance_overdrawn message';
  raise notice 'PASS: a zero allowance admits no line';
end $$;

-- $100 fortnightly = $2,600 a year. A $40 fortnightly and a $50 weekly line ($1,040 + $2,600)
-- exceed it; $40 fortnightly and $25 weekly ($1,040 + $1,300) fit.
update public.member_allowance set amount_cents = 100_00, frequency = 'fortnightly'
  where member_id = current_setting('over.amid')::uuid;
insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id) values
  (current_setting('over.hid')::uuid, 'discretionary', 'Gym', 40_00, 'fortnightly', current_setting('over.amid')::uuid),
  (current_setting('over.hid')::uuid, 'discretionary', 'Books', 25_00, 'weekly', current_setting('over.amid')::uuid);

do $$ begin
  insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id)
    values (current_setting('over.hid')::uuid, 'discretionary', 'Big', 40_00, 'weekly', current_setting('over.amid')::uuid);
  raise exception 'FAIL: a line overdrew the allowance';
exception when check_violation then
  raise notice 'PASS: a line that would overdraw the allowance is refused';
end $$;

-- Annual cents decide, whatever the cadence: $1,000 a year more fits the $260 remaining? No; $260 does.
do $$ begin
  insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id)
    values (current_setting('over.hid')::uuid, 'discretionary', 'Annual', 260_01, 'annual', current_setting('over.amid')::uuid);
  raise exception 'FAIL: an annual line one cent over was accepted';
exception when check_violation then
  raise notice 'PASS: one cent over the allowance is refused';
end $$;
insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id)
  values (current_setting('over.hid')::uuid, 'discretionary', 'Exact', 260_00, 'annual', current_setting('over.amid')::uuid);

-- Raising a line, or drawing an existing ordinary line, past the allowance is refused.
do $$ begin
  update public.budget_line set amount_cents = 41_00 where name = 'Gym';
  raise exception 'FAIL: raising a drawn line overdrew the allowance';
exception when check_violation then
  raise notice 'PASS: raising a drawn line past the allowance is refused';
end $$;
insert into public.budget_line (household_id, line_group, name, amount_cents, frequency)
  values (current_setting('over.hid')::uuid, 'discretionary', 'Ordinary', 5_00, 'weekly');
do $$ begin
  update public.budget_line set allowance_member_id = current_setting('over.amid')::uuid where name = 'Ordinary';
  raise exception 'FAIL: drawing an ordinary line overdrew the allowance';
exception when check_violation then
  raise notice 'PASS: drawing an existing line past the allowance is refused';
end $$;

-- Trimming a line, and unrelated edits, are always allowed; so is releasing a line.
update public.budget_line set amount_cents = 30_00 where name = 'Gym';
update public.budget_line set name = 'Gym membership' where name = 'Gym';
update public.budget_line set allowance_member_id = null where name = 'Exact';
update public.budget_line set allowance_member_id = current_setting('over.amid')::uuid where name = 'Exact';

-- commit_planning_changes is held to the limit, for creates and updates alike.
do $$ begin
  perform public.commit_planning_changes(
    p_budget_line_creates := jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'household_id', current_setting('over.hid'),
      'line_group', 'discretionary', 'name', 'Planned', 'amount_cents', 1_000_00, 'frequency', 'weekly',
      'allowance_member_id', current_setting('over.amid')
    ))
  );
  raise exception 'FAIL: a planning commit created an overdrawing line';
exception when check_violation then
  raise notice 'PASS: a planning commit cannot create an overdrawing line';
end $$;
select set_config('over.gymid', id::text, false) from public.budget_line where name = 'Gym membership';
do $$ begin
  perform public.commit_planning_changes(
    p_budget_line_updates := jsonb_build_object(current_setting('over.gymid'), jsonb_build_object('amount_cents', 1_000_00))
  );
  raise exception 'FAIL: a planning commit raised a line past the allowance';
exception when check_violation then
  raise notice 'PASS: a planning commit cannot raise a line past the allowance';
end $$;

-- Lowering the allowance below what is drawn is refused, by amount or by cadence.
do $$ begin
  update public.member_allowance set amount_cents = 50_00 where member_id = current_setting('over.amid')::uuid;
  raise exception 'FAIL: the allowance was lowered below what is drawn';
exception when check_violation then
  raise notice 'PASS: lowering the allowance below the drawn total is refused';
end $$;
do $$ begin
  update public.member_allowance set frequency = 'monthly' where member_id = current_setting('over.amid')::uuid;
  raise exception 'FAIL: a cadence change took the allowance below what is drawn';
exception when check_violation then
  raise notice 'PASS: a cadence change below the drawn total is refused';
end $$;
do $$ begin
  update public.member_allowance set frequency = 'every_n_weeks', interval_count = 4
    where member_id = current_setting('over.amid')::uuid;
  raise exception 'FAIL: an interval change took the allowance below what is drawn';
exception when check_violation then
  raise notice 'PASS: an interval change below the drawn total is refused';
end $$;

-- Raising the allowance, changing its account, or lowering it to exactly the drawn total is allowed.
update public.member_allowance set amount_cents = 200_00 where member_id = current_setting('over.amid')::uuid;
-- Drawn: $30 fortnightly + $25 weekly + $260 annual = $2,340 a year.
update public.member_allowance set frequency = 'annual', amount_cents = 2_340_00
  where member_id = current_setting('over.amid')::uuid;
do $$ begin
  update public.member_allowance set amount_cents = 2_339_99 where member_id = current_setting('over.amid')::uuid;
  raise exception 'FAIL: the allowance went one cent below the drawn total';
exception when check_violation then
  raise notice 'PASS: the allowance may equal but not undercut the drawn total';
end $$;

-- Bob cannot see Alice's lines, yet lowering her allowance is refused for him too,
-- with a message that names no amount.
select set_config('request.jwt.claims', '{"sub":"34000000-0000-0000-0000-000000000002","email":"over-bob@example.com"}', true);
do $$ begin
  assert not exists (select 1 from public.budget_line where allowance_member_id is not null), 'Bob must not see Alice''s lines';
  update public.member_allowance set amount_cents = 1 where member_id = current_setting('over.amid')::uuid;
  raise exception 'FAIL: a co-member lowered the allowance below what is drawn';
exception when check_violation then
  assert sqlerrm = 'allowance_overdrawn', 'the refusal must disclose nothing of the drawn lines';
  raise notice 'PASS: a co-member cannot lower an allowance below what is drawn';
end $$;

-- A line repointed at a member's own zero allowance is refused.
select set_config('over.bmid', id::text, false) from public.members
  where household_id = current_setting('over.hid')::uuid and id <> current_setting('over.amid')::uuid;
insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id)
  values (current_setting('over.hid')::uuid, 'discretionary', 'Bob zero', 1, 'annual', null);
do $$ begin
  update public.budget_line set allowance_member_id = current_setting('over.bmid')::uuid
    where name = 'Bob zero';
  raise exception 'FAIL: a line was drawn from a zero allowance by repointing';
exception when check_violation then
  raise notice 'PASS: a zero allowance admits no repointed line';
end $$;

rollback;
