-- Assertions for the planning-mode save RPC: a create, an update, and a delete
-- land across inflows, budget_line, and savings_goal in one call; an update
-- patch touches only the columns it names, leaving every other column exactly
-- as stored; and household RLS — not anything the function checks itself —
-- is what stops one household's save from touching another's rows.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.com');

-- ── Alice's household, with one row per sandboxed table ───────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","email":"alice@example.com"}', true);
select public.create_household('Alice''s household', 'Alice') as cpc_alice_hid \gset
select set_config('cpc.alice_hid', :'cpc_alice_hid', false);
select id as cpc_alice_mid from public.members
  where household_id = current_setting('cpc.alice_hid')::uuid \gset
select set_config('cpc.alice_mid', :'cpc_alice_mid', false);

insert into public.inflows (household_id, member_id, name, type, schedule, amount_cents)
  values (current_setting('cpc.alice_hid')::uuid, current_setting('cpc.alice_mid')::uuid,
    'Alice salary', 'salary', 'fortnightly', 5_000_00)
  returning id as cpc_alice_inflow \gset
select set_config('cpc.alice_inflow', :'cpc_alice_inflow', false);

insert into public.budget_line (household_id, line_group, name, amount_cents, frequency)
  values (current_setting('cpc.alice_hid')::uuid, 'needs', 'Rent', 2_000_00, 'fortnightly')
  returning id as cpc_alice_line \gset
select set_config('cpc.alice_line', :'cpc_alice_line', false);

insert into public.savings_goal (household_id, name, target_amount_cents)
  values (current_setting('cpc.alice_hid')::uuid, 'Holiday', 3_000_00)
  returning id as cpc_alice_goal \gset
select set_config('cpc.alice_goal', :'cpc_alice_goal', false);

-- ── Bob's household, with one inflow of his own ────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000002","email":"bob@example.com"}', true);
select public.create_household('Bob''s household', 'Bob') as cpc_bob_hid \gset
select set_config('cpc.bob_hid', :'cpc_bob_hid', false);
select id as cpc_bob_mid from public.members
  where household_id = current_setting('cpc.bob_hid')::uuid \gset
select set_config('cpc.bob_mid', :'cpc_bob_mid', false);

insert into public.inflows (household_id, member_id, name, type, schedule, amount_cents)
  values (current_setting('cpc.bob_hid')::uuid, current_setting('cpc.bob_mid')::uuid,
    'Bob salary', 'salary', 'fortnightly', 4_000_00)
  returning id as cpc_bob_inflow, amount_cents as cpc_bob_amount \gset
select set_config('cpc.bob_inflow', :'cpc_bob_inflow', false);
select set_config('cpc.bob_amount', :'cpc_bob_amount', false);

-- ── Alice saves a create, an update, and a delete across all three tables ──────

select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","email":"alice@example.com"}', true);

select public.commit_planning_changes(
  p_inflow_creates := jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'household_id', current_setting('cpc.alice_hid'),
    'member_id', current_setting('cpc.alice_mid'),
    'name', 'Side hustle', 'type', 'other', 'schedule', 'monthly', 'amount_cents', 500_00
  )),
  p_inflow_updates := jsonb_build_object(
    current_setting('cpc.alice_inflow'), jsonb_build_object('amount_cents', 5_500_00)
  ),
  p_budget_line_creates := '[]'::jsonb,
  p_budget_line_updates := jsonb_build_object(
    current_setting('cpc.alice_line'), jsonb_build_object('amount_cents', 2_100_00)
  ),
  p_savings_goal_creates := '[]'::jsonb,
  p_savings_goal_updates := '{}'::jsonb,
  p_savings_goal_deletes := array[current_setting('cpc.alice_goal')]::uuid[]
);

do $$
declare v_alice_hid uuid := current_setting('cpc.alice_hid')::uuid;
begin
  assert (select count(*) from public.inflows where household_id = v_alice_hid) = 2,
    'a create should land alongside the household''s existing inflow';
  assert (select amount_cents from public.inflows where id = current_setting('cpc.alice_inflow')::uuid) = 5_500_00,
    'a patched field should take the update''s value';
  assert (select name from public.inflows where id = current_setting('cpc.alice_inflow')::uuid) = 'Alice salary',
    'a field absent from the patch should be left exactly as stored';
  assert (select amount_cents from public.budget_line where id = current_setting('cpc.alice_line')::uuid) = 2_100_00,
    'a budget-line patch should take effect alongside the inflow changes';
  assert (select line_group from public.budget_line where id = current_setting('cpc.alice_line')::uuid) = 'needs',
    'a budget-line field absent from the patch should be left exactly as stored';
  assert not exists (select 1 from public.savings_goal where id = current_setting('cpc.alice_goal')::uuid),
    'a deleted savings goal should be gone';
end $$;

-- ── A patch explicitly clearing a field is distinct from one that never mentions it ──

do $$
declare v_id uuid;
begin
  v_id := (select id from public.inflows where name = 'Side hustle');

  perform public.commit_planning_changes(
    p_inflow_updates := jsonb_build_object(v_id::text, jsonb_build_object('ends_on', '2027-06-30'))
  );
  assert (select ends_on from public.inflows where id = v_id) = date '2027-06-30',
    'a patch naming a nullable field should set it';

  perform public.commit_planning_changes(
    p_inflow_updates := jsonb_build_object(v_id::text, jsonb_build_object('ends_on', null))
  );
  assert (select ends_on from public.inflows where id = v_id) is null,
    'a patch explicitly setting a field to null should clear it, not leave the prior value alone';
end $$;

-- ── Household RLS, not the function body, is what scopes every write ──────────
--
-- Alice's own view of Bob's row is RLS-hidden entirely (0 rows, not a row she
-- can compare against), so what she attempts is checked against what lands, and
-- what actually happened is verified afterwards from Bob's own session.

-- An update keyed on another household's row id matches no row Alice's RLS lets
-- her see or write, so it is silently a no-op rather than an error.
select public.commit_planning_changes(
  p_inflow_updates := jsonb_build_object(
    current_setting('cpc.bob_inflow'), jsonb_build_object('amount_cents', 1)
  )
);

-- Likewise a delete naming another household's row id.
select public.commit_planning_changes(
  p_inflow_deletes := array[current_setting('cpc.bob_inflow')]::uuid[]
);

-- A create forging another household's id fails the insert policy's WITH CHECK
-- outright, rolling back the whole call rather than landing in Bob's household.
do $$
begin
  begin
    perform public.commit_planning_changes(
      p_inflow_creates := jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'household_id', current_setting('cpc.bob_hid'),
        'name', 'Forged', 'type', 'other', 'taxable', false,
        'schedule', 'monthly', 'amount_cents', 1
      ))
    );
    raise exception 'FAIL: a create forging another household''s id should have been rejected';
  exception when insufficient_privilege then
    raise notice 'PASS: RLS rejected a create forging another household''s id';
  end;
end $$;

do $$ begin
  assert not exists (select 1 from public.inflows where name = 'Forged'),
    'a rejected forged create should leave no trace visible to Alice';
end $$;

-- Verified from Bob's own session: his row survived every one of Alice's
-- attempts untouched, and no forged row landed in his household either.
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000002","email":"bob@example.com"}', true);

do $$ begin
  assert (select amount_cents from public.inflows where id = current_setting('cpc.bob_inflow')::uuid)
    = current_setting('cpc.bob_amount')::bigint,
    'an update keyed on another household''s row should touch nothing';
  assert exists (select 1 from public.inflows where id = current_setting('cpc.bob_inflow')::uuid),
    'a delete naming another household''s row should remove nothing';
  assert (select count(*) from public.inflows where household_id = current_setting('cpc.bob_hid')::uuid) = 1,
    'a rejected forged create should leave no trace in the household it targeted';
end $$;

rollback;
