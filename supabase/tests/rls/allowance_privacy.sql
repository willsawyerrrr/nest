-- Assertions that budget lines drawn from a member's allowance are private to
-- that member: a co-member cannot read, write, move, or delete them, learns no
-- drawn total, and `commit_planning_changes` (an invoker function) is held to the
-- same policy.
-- `service_role` still sees every line.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '33000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'priv-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '33000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'priv-bob@example.com');

-- Alice creates the household and invites Bob.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33000000-0000-0000-0000-000000000001","email":"priv-alice@example.com"}', true);
select public.create_household('Privacy Household', 'Alice') as hid \gset
select set_config('priv.hid', :'hid', false);
select id as amid from public.members where household_id = :'hid'::uuid \gset
select set_config('priv.amid', :'amid', false);
select invite_code as code from public.create_invite_code() \gset

select set_config('request.jwt.claims', '{"sub":"33000000-0000-0000-0000-000000000002","email":"priv-bob@example.com"}', true);
select public.join_household(:'code', 'Bob');
select id as bmid from public.members where household_id = :'hid'::uuid and id <> :'amid'::uuid \gset
select set_config('priv.bmid', :'bmid', false);

-- Alice draws two lines from her allowance and keeps one ordinary line.
select set_config('request.jwt.claims', '{"sub":"33000000-0000-0000-0000-000000000001","email":"priv-alice@example.com"}', true);
update public.member_allowance set amount_cents = 100_00, frequency = 'fortnightly'
  where member_id = current_setting('priv.amid')::uuid;
insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id) values
  (current_setting('priv.hid')::uuid, 'discretionary', 'Gym', 40_00, 'fortnightly', current_setting('priv.amid')::uuid),
  (current_setting('priv.hid')::uuid, 'discretionary', 'Books', 10_00, 'weekly', current_setting('priv.amid')::uuid),
  (current_setting('priv.hid')::uuid, 'discretionary', 'Streaming', 20_00, 'monthly', null);

do $$ begin
  assert (select count(*) from public.budget_line) = 3, 'Alice should read her own allowance lines and the ordinary line';
end $$;

-- Bob sees the ordinary line only.
select set_config('request.jwt.claims', '{"sub":"33000000-0000-0000-0000-000000000002","email":"priv-bob@example.com"}', true);
do $$ begin
  assert (select count(*) from public.budget_line) = 1 and exists (select 1 from public.budget_line where name = 'Streaming'),
    'Bob must see only the ordinary line';
  assert exists (select 1 from public.member_allowance where member_id = current_setting('priv.amid')::uuid),
    'Bob still sees Alice''s allowance amount and cadence';
end $$;

-- Bob cannot edit, move, or delete Alice's lines: they match nothing.
update public.budget_line set amount_cents = 1 where name = 'Gym';
delete from public.budget_line where name = 'Books';
select set_config('request.jwt.claims', '{"sub":"33000000-0000-0000-0000-000000000001","email":"priv-alice@example.com"}', true);
do $$ begin
  assert (select amount_cents from public.budget_line where name = 'Gym') = 40_00, 'Bob must not edit Alice''s allowance line';
  assert exists (select 1 from public.budget_line where name = 'Books'), 'Bob must not delete Alice''s allowance line';
end $$;

-- Bob cannot draw a line from Alice's allowance, on insert or by repointing one of his own.
select set_config('request.jwt.claims', '{"sub":"33000000-0000-0000-0000-000000000002","email":"priv-bob@example.com"}', true);
do $$ begin
  insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id)
    values (current_setting('priv.hid')::uuid, 'discretionary', 'Sneaky', 5_00, 'weekly', current_setting('priv.amid')::uuid);
  raise exception 'FAIL: Bob drew a line from Alice''s allowance';
exception when insufficient_privilege then
  raise notice 'PASS: a co-member cannot draw a line from another''s allowance';
end $$;
do $$ begin
  update public.budget_line set allowance_member_id = current_setting('priv.amid')::uuid where name = 'Streaming';
  raise exception 'FAIL: Bob repointed a line at Alice''s allowance';
exception when insufficient_privilege then
  raise notice 'PASS: a line cannot be repointed at a co-member''s allowance';
end $$;

-- commit_planning_changes runs under the caller's policies: it cannot create, patch, or delete a hidden line.
do $$ begin
  perform public.commit_planning_changes(
    p_budget_line_creates := jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'household_id', current_setting('priv.hid'),
      'line_group', 'discretionary', 'name', 'Planned', 'amount_cents', 5_00, 'frequency', 'weekly',
      'allowance_member_id', current_setting('priv.amid')
    ))
  );
  raise exception 'FAIL: a planning commit drew a line from Alice''s allowance';
exception when insufficient_privilege then
  raise notice 'PASS: a planning commit cannot create a line on a co-member''s allowance';
end $$;
select set_config('request.jwt.claims', '{"sub":"33000000-0000-0000-0000-000000000001","email":"priv-alice@example.com"}', true);
select id::text as gymid from public.budget_line where name = 'Gym' \gset
select id::text as booksid from public.budget_line where name = 'Books' \gset
select set_config('request.jwt.claims', '{"sub":"33000000-0000-0000-0000-000000000002","email":"priv-bob@example.com"}', true);
select public.commit_planning_changes(
  p_budget_line_updates := jsonb_build_object(:'gymid', jsonb_build_object('amount_cents', 1)),
  p_budget_line_deletes := array[:'booksid'::uuid]
);
select set_config('request.jwt.claims', '{"sub":"33000000-0000-0000-0000-000000000001","email":"priv-alice@example.com"}', true);
do $$ begin
  assert (select amount_cents from public.budget_line where name = 'Gym') = 40_00, 'a planning commit must not patch a hidden line';
  assert exists (select 1 from public.budget_line where name = 'Books'), 'a planning commit must not delete a hidden line';
end $$;

-- Alice may release her own line to an ordinary one, after which Bob sees it.
update public.budget_line set allowance_member_id = null where name = 'Books';
select set_config('request.jwt.claims', '{"sub":"33000000-0000-0000-0000-000000000002","email":"priv-bob@example.com"}', true);
do $$ begin
  assert exists (select 1 from public.budget_line where name = 'Books'), 'a released line is an ordinary shared line';
end $$;

-- service_role-style roles that bypass RLS read every line.
reset role;
do $$ begin
  assert (select count(*) from public.budget_line where allowance_member_id is not null) = 1, 'the owner role sees the allowance line';
end $$;

-- No function exposes the drawn totals.
do $$ begin
  assert not exists (select 1 from pg_proc where proname = 'hidden_allowance_drawn'), 'drawn totals must not be exposed';
end $$;

rollback;
