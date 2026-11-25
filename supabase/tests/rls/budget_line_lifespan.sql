-- Assertions for budget item lifespans: start and retirement dates, retiring,
-- change from a date, the delete guard, and the dated default item.
--
-- Rent is retired mid-October: September and early-October rent stays on it,
-- and rent paid after its retirement no longer matches its rule. Gym changes
-- price from 10 October: earlier visits stay on the old item, later ones count
-- toward the replacement through the rule it carried over. An item with counted
-- spend cannot be deleted; one with none can. The default item is dated, so
-- uncaught spend resolves to the default in force when it was posted, and
-- retiring the default needs a new one. A member choice is refused outside the
-- item's lifespan.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '87600000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'life-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '87600000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'life-carol@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"87600000-0000-0000-0000-000000000001","email":"life-alice@example.com"}', true);
select public.create_household('Lifespan Household', 'Alice') as hid \gset
select set_config('bl.hid', :'hid', false);
select id as amid from public.members where household_id = :'hid'::uuid \gset
select set_config('bl.amid', :'amid', false);
select set_config('request.jwt.claims', '{"sub":"87600000-0000-0000-0000-000000000002","email":"life-carol@example.com"}', true);
select public.create_household('Carol Household', 'Carol') as chid \gset
select set_config('bl.chid', :'chid', false);
reset role;

insert into public.accounts (household_id, owner_member_id, name, type, source, external_id) values
  (:'hid', null, 'Joint', 'transaction', 'up', 'bl-acc-joint'),
  (:'chid', null, 'Carol Joint', 'transaction', 'up', 'bl-acc-carol');
select id as joint from public.accounts where external_id = 'bl-acc-joint' \gset
select id as carol_acc from public.accounts where external_id = 'bl-acc-carol' \gset

update public.member_allowance set amount_cents = 30_00, frequency = 'monthly' where member_id = :'amid';
insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, starts_on, allowance_member_id) values
  (:'hid', 'needs', 'Rent', 2_000_00, 'monthly', '2026-01-01', null),
  (:'hid', 'wants', 'Gym', 25_00, 'monthly', '2026-01-01', null),
  (:'hid', 'discretionary', 'Discretionary spend', 100_00, 'fortnightly', '2026-01-01', null),
  (:'hid', 'discretionary', 'Fun money', 50_00, 'fortnightly', '2026-01-01', null),
  (:'hid', 'wants', 'Streaming', 20_00, 'monthly', '2026-01-01', null),
  (:'hid', 'wants', 'Holiday fund', 100_00, 'monthly', '2027-03-01', null),
  (:'hid', 'discretionary', 'Alice''s books', 20_00, 'monthly', '2026-01-01', :'amid'),
  (:'chid', 'needs', 'Carol rent', 1_000_00, 'monthly', '2026-01-01', null);
insert into public.budget_line (household_id, line_group, name, amount_cents, frequency) values
  (:'hid', 'wants', 'Started today', 10_00, 'monthly');
select set_config('bl.rent', (select id::text from public.budget_line where name = 'Rent'), false);
select set_config('bl.gym', (select id::text from public.budget_line where name = 'Gym'), false);
select set_config('bl.disc', (select id::text from public.budget_line where name = 'Discretionary spend'), false);
select set_config('bl.fun', (select id::text from public.budget_line where name = 'Fun money'), false);
select set_config('bl.streaming', (select id::text from public.budget_line where name = 'Streaming'), false);
select set_config('bl.holiday', (select id::text from public.budget_line where name = 'Holiday fund'), false);
select set_config('bl.books', (select id::text from public.budget_line where name = 'Alice''s books'), false);
select set_config('bl.carol_rent', (select id::text from public.budget_line where name = 'Carol rent'), false);
select set_config('bl.today_line', (select id::text from public.budget_line where name = 'Started today'), false);

-- September and October 2026, Australia/Sydney.
insert into public.transactions
  (household_id, account_id, posted_at, amount_cents, description, kind, status, source, external_id, external_category)
  values
  (:'hid', :'joint', '2026-09-01T01:00:00Z', -2_000_00, 'J Smith', 'expense', 'settled', 'up', 'bl-rent-sep', null),
  (:'hid', :'joint', '2026-10-01T01:00:00Z', -2_000_00, 'J Smith', 'expense', 'settled', 'up', 'bl-rent-oct', null),
  (:'hid', :'joint', '2026-10-20T01:00:00Z', -2_000_00, 'J Smith', 'expense', 'settled', 'up', 'bl-rent-late', null),
  (:'hid', :'joint', '2026-10-05T01:00:00Z', -25_00, 'PLANET FITNESS', 'expense', 'settled', 'up', 'bl-gym-before', 'fitness-and-wellbeing'),
  (:'hid', :'joint', '2026-10-12T01:00:00Z', -30_00, 'PLANET FITNESS', 'expense', 'settled', 'up', 'bl-gym-after', 'fitness-and-wellbeing'),
  (:'hid', :'joint', '2026-09-15T01:00:00Z', -15_00, 'Cafe', 'expense', 'settled', 'up', 'bl-cafe-sep', 'restaurants-and-cafes'),
  (:'hid', :'joint', '2026-10-15T01:00:00Z', -18_00, 'Cafe', 'expense', 'settled', 'up', 'bl-cafe-oct', 'restaurants-and-cafes'),
  (:'chid', :'carol_acc', '2026-10-01T01:00:00Z', -1_000_00, 'Landlord', 'expense', 'settled', 'up', 'bl-carol-rent', null);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"87600000-0000-0000-0000-000000000001","email":"life-alice@example.com"}', true);

-- ── Start dates and the retirement guard ──────────────────────────────────────

do $$
declare
  v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  assert (select starts_on from public.budget_line where id = current_setting('bl.today_line')::uuid) = v_today,
    'a new item starts today unless told otherwise';

  begin
    insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, retired_on)
      values (current_setting('bl.hid')::uuid, 'wants', 'Born retired', 1_00, 'monthly', '2026-12-01');
    raise exception 'an item cannot be inserted retired';
  exception when check_violation then
    assert sqlerrm = 'budget_line_retired_on_immutable', sqlerrm;
  end;
  begin
    update public.budget_line set retired_on = '2026-12-01' where id = current_setting('bl.streaming')::uuid;
    raise exception 'an item is retired only through retire_budget_line';
  exception when check_violation then
    assert sqlerrm = 'budget_line_retired_on_immutable', sqlerrm;
  end;
  begin
    update public.budget_line set starts_on = null where id = current_setting('bl.streaming')::uuid;
    raise exception 'an item always has a start date';
  exception when not_null_violation then null;
  end;
end $$;

-- ── The default item over time ────────────────────────────────────────────────

do $$ begin
  begin
    perform public.set_household_default_budget_line(current_setting('bl.books')::uuid, '2026-01-01');
    raise exception 'a line drawn from an allowance must not be the default item';
  exception when check_violation then
    assert sqlerrm = 'default_budget_line_invalid', sqlerrm;
  end;
  begin
    perform public.set_household_default_budget_line(current_setting('bl.disc')::uuid, '2025-12-01');
    raise exception 'the default cannot start before its item does';
  exception when check_violation then
    assert sqlerrm = 'default_budget_line_invalid', sqlerrm;
  end;

  perform public.set_household_default_budget_line(current_setting('bl.disc')::uuid, '2026-01-01');
  assert (select count(*) from public.household_default_budget_line) = 1, 'the history holds one row';
  assert (select budget_line_id from public.household_default_budget_line where valid_from = '2026-01-01')
    = current_setting('bl.disc')::uuid, 'Discretionary spend is the default from January';
  assert (select target_kind = 'budget_line' and budget_line_id = current_setting('bl.disc')::uuid
      from public.spend_resolution() where transaction_id = (select id from public.transactions where external_id = 'bl-cafe-oct')),
    'uncaught spend counts toward the default';

  -- Rules: rent at the rent amount; gym by payee.
  perform set_config('bl.r_rent', public.create_spend_rule('budget_line', current_setting('bl.rent')::uuid,
    p_description_pattern => 'j smith', p_description_match => 'equals', p_amount_cents => 2_000_00,
    p_apply_from => '2026-08-01')::text, false);
  perform set_config('bl.r_gym', public.create_spend_rule('budget_line', current_setting('bl.gym')::uuid,
    p_description_pattern => 'planet fitness', p_apply_from => '2026-08-01')::text, false);
  perform set_config('bl.r_holiday', public.create_spend_rule('budget_line', current_setting('bl.holiday')::uuid,
    p_description_pattern => 'cafe', p_apply_from => '2026-08-01')::text, false);

  assert (select budget_line_id from public.spend_resolution()
      where transaction_id = (select id from public.transactions where external_id = 'bl-cafe-oct'))
    = current_setting('bl.disc')::uuid,
    'a rule targeting a not-yet-started item matches nothing before its start, falling through to the default';
end $$;

-- ── Counted spend and the delete guard ────────────────────────────────────────

do $$ begin
  assert (select array_agg(x order by x) from public.budget_lines_with_counted_spend() as x)
    = (select array_agg(id order by id) from public.budget_line
      where id in (current_setting('bl.rent')::uuid, current_setting('bl.gym')::uuid, current_setting('bl.disc')::uuid)),
    'the items spend has counted toward, by rule or default';

  begin
    delete from public.budget_line where id = current_setting('bl.rent')::uuid;
    raise exception 'an item with counted spend is retired, not deleted';
  exception when check_violation then
    assert sqlerrm = 'budget_line_has_spend', sqlerrm;
  end;
  begin
    delete from public.budget_line where id = current_setting('bl.disc')::uuid;
    raise exception 'the default item with spend resolved to it cannot be deleted';
  exception when check_violation then
    assert sqlerrm = 'budget_line_has_spend', sqlerrm;
  end;

  -- The holiday fund has a rule but no spend has ever counted toward it.
  delete from public.budget_line where id = current_setting('bl.holiday')::uuid;
  assert not exists (select 1 from public.budget_line where id = current_setting('bl.holiday')::uuid),
    'an item no spend has counted toward can be deleted';
  assert not exists (select 1 from public.spend_rule where id = current_setting('bl.r_holiday')::uuid),
    'its rules go with it';
end $$;

-- ── Retiring ──────────────────────────────────────────────────────────────────

do $$
declare
  v_rent_late uuid := (select id from public.transactions where external_id = 'bl-rent-late');
begin
  begin
    perform public.retire_budget_line(current_setting('bl.rent')::uuid, '2026-01-01');
    raise exception 'an item retires after it starts';
  exception when check_violation then
    assert sqlerrm = 'budget_line_retire_before_start', sqlerrm;
  end;
  begin
    perform public.retire_budget_line(current_setting('bl.carol_rent')::uuid, '2026-10-10');
    raise exception 'another household''s item is not found';
  exception when no_data_found then
    assert sqlerrm = 'budget_line_not_found', sqlerrm;
  end;

  perform public.retire_budget_line(current_setting('bl.rent')::uuid, '2026-10-10');

  assert (select retired_on from public.budget_line where id = current_setting('bl.rent')::uuid) = '2026-10-10',
    'Rent retires on 10 October';
  assert (select array_agg(budget_line_id::text order by posted_at) from public.spend_resolution()
      where transaction_id in (select id from public.transactions where external_id in ('bl-rent-sep', 'bl-rent-oct')))
    = array[current_setting('bl.rent'), current_setting('bl.rent')],
    'past rent stays on the retired Rent item';
  assert (select budget_line_id from public.spend_resolution() where transaction_id = v_rent_late)
    = current_setting('bl.disc')::uuid,
    'rent paid after the retirement no longer matches its rule';
  assert (select valid_until from public.spend_rule_version where rule_id = current_setting('bl.r_rent')::uuid)
    = '2026-10-10T00:00:00+11:00'::timestamptz,
    'the rule stops at the retirement';
  assert not exists (select 1 from public.current_spend_rules where id = current_setting('bl.r_rent')::uuid),
    'a retired item''s rule is no longer current';

  begin
    perform public.retire_budget_line(current_setting('bl.rent')::uuid, '2026-11-01');
    raise exception 'a retired item stays retired';
  exception when check_violation then
    assert sqlerrm = 'budget_line_retired', sqlerrm;
  end;
  begin
    update public.budget_line set retired_on = null where id = current_setting('bl.rent')::uuid;
    raise exception 'a retired item cannot be un-retired';
  exception when check_violation then
    assert sqlerrm = 'budget_line_retired_on_immutable', sqlerrm;
  end;
  begin
    perform public.create_spend_rule('budget_line', current_setting('bl.rent')::uuid, p_description_pattern => 'x');
    raise exception 'a rule cannot target an item retired by its start';
  exception when check_violation then
    assert sqlerrm = 'spend_target_inactive', sqlerrm;
  end;

  -- Member choices: refused outside the lifespan, kept inside it.
  begin
    perform public.set_transaction_spend_target(v_rent_late, 'budget_line', current_setting('bl.rent')::uuid);
    raise exception 'a retired item cannot take spend posted after its retirement';
  exception when check_violation then
    assert sqlerrm = 'spend_target_inactive', sqlerrm;
  end;
  begin
    perform public.set_transaction_spend_target(
      (select id from public.transactions where external_id = 'bl-cafe-sep'), 'budget_line', current_setting('bl.today_line')::uuid);
    raise exception 'an item cannot take spend posted before its start';
  exception when check_violation then
    assert sqlerrm = 'spend_target_inactive', sqlerrm;
  end;
  perform public.set_transaction_spend_target(
    (select id from public.transactions where external_id = 'bl-rent-oct'), 'budget_line', current_setting('bl.rent')::uuid);
  assert (select reason from public.spend_resolution()
      where transaction_id = (select id from public.transactions where external_id = 'bl-rent-oct')) = 'member_choice',
    'a choice inside the lifespan is accepted';

  -- Retiring the default needs a new one, from the retirement day.
  begin
    perform public.retire_budget_line(current_setting('bl.disc')::uuid, '2026-10-01');
    raise exception 'retiring the default needs a replacement';
  exception when check_violation then
    assert sqlerrm = 'budget_line_default_replacement_required', sqlerrm;
  end;
  begin
    perform public.retire_budget_line(current_setting('bl.disc')::uuid, '2026-10-01', current_setting('bl.rent')::uuid);
    raise exception 'a retired item cannot become the default';
  exception when check_violation then
    assert sqlerrm = 'default_budget_line_invalid', sqlerrm;
  end;
  perform public.retire_budget_line(current_setting('bl.disc')::uuid, '2026-10-01', current_setting('bl.fun')::uuid);

  assert (select array_agg(budget_line_id::text order by valid_from) from public.household_default_budget_line)
    = array[current_setting('bl.disc'), current_setting('bl.fun')],
    'the default history names the old default, then the new one from the retirement';
  assert (select budget_line_id from public.spend_resolution()
      where transaction_id = (select id from public.transactions where external_id = 'bl-cafe-sep'))
    = current_setting('bl.disc')::uuid,
    'old uncaught spend resolves to the old default';
  assert (select budget_line_id from public.spend_resolution()
      where transaction_id = (select id from public.transactions where external_id = 'bl-cafe-oct'))
    = current_setting('bl.fun')::uuid,
    'later uncaught spend resolves to the new default';
end $$;

-- ── Change from a date ────────────────────────────────────────────────────────

do $$
declare
  v_new uuid;
  v_new_rule uuid;
begin
  v_new := public.change_budget_line_from(
    current_setting('bl.gym')::uuid, '2026-10-10', 'wants', 'Gym', 30_00, 'monthly');
  perform set_config('bl.gym_new', v_new::text, false);

  assert (select retired_on from public.budget_line where id = current_setting('bl.gym')::uuid) = '2026-10-10',
    'the old item retires on the change date';
  assert (select starts_on = '2026-10-10' and amount_cents = 30_00 and name = 'Gym' and retired_on is null
      from public.budget_line where id = v_new),
    'the replacement starts that day at the new amount';
  assert (select budget_line_id from public.spend_resolution()
      where transaction_id = (select id from public.transactions where external_id = 'bl-gym-before'))
    = current_setting('bl.gym')::uuid,
    'spend before the change stays on the old item';
  assert (select budget_line_id from public.spend_resolution()
      where transaction_id = (select id from public.transactions where external_id = 'bl-gym-after')) = v_new,
    'spend after the change counts toward the replacement';

  select id into v_new_rule from public.current_spend_rules where budget_line_id = v_new;
  assert v_new_rule is not null and v_new_rule <> current_setting('bl.r_gym')::uuid, 'the rule is copied onto the replacement';
  assert (select description_pattern = 'planet fitness'
      and valid_from = '2026-10-10T00:00:00+11:00'::timestamptz
      and sort_order = (select sort_order from public.spend_rule_version where rule_id = current_setting('bl.r_gym')::uuid)
      from public.current_spend_rules where id = v_new_rule),
    'the copy carries the conditions and place in the order, from the change date';
  assert (select valid_until from public.spend_rule_version where rule_id = current_setting('bl.r_gym')::uuid)
    = '2026-10-10T00:00:00+11:00'::timestamptz,
    'the old rule retires at the change date';

  -- The default item changing from a date carries the default with it.
  perform set_config('bl.fun_new', public.change_budget_line_from(
    current_setting('bl.fun')::uuid, '2026-11-01', 'discretionary', 'Fun money', 60_00, 'fortnightly')::text, false);
  assert (select array_agg(budget_line_id::text order by valid_from) from public.household_default_budget_line)
    = array[current_setting('bl.disc'), current_setting('bl.fun'), current_setting('bl.fun_new')],
    'the replacement becomes the default from the change date';

  -- A drawn item's replacement keeps its allowance, which the retired item no longer draws on.
  perform public.change_budget_line_from(
    current_setting('bl.books')::uuid, '2026-11-01', 'discretionary', 'Alice''s books', 30_00, 'monthly');
  assert (select allowance_member_id from public.budget_line where name = 'Alice''s books' and retired_on is null)
    = current_setting('bl.amid')::uuid,
    'the replacement draws on the same allowance, the retired item no longer counting toward its total';

  begin
    perform public.change_budget_line_from(
      current_setting('bl.gym')::uuid, '2026-11-01', 'wants', 'Gym', 40_00, 'monthly');
    raise exception 'a retired item cannot change again';
  exception when check_violation then
    assert sqlerrm = 'budget_line_retired', sqlerrm;
  end;
end $$;

-- ── Removing the household takes its items, spend or not ──────────────────────

reset role;
do $$ begin
  delete from public.households where id = current_setting('bl.chid')::uuid;
  assert not exists (select 1 from public.budget_line where id = current_setting('bl.carol_rent')::uuid),
    'a household''s items go with it';
end $$;

-- ── Grants ────────────────────────────────────────────────────────────────────

do $$ begin
  assert has_function_privilege('authenticated', 'public.retire_budget_line(uuid, date, uuid)', 'execute'),
    'members retire items';
  assert has_function_privilege('authenticated', 'public.change_budget_line_from(uuid, date, public.budget_group, text, bigint, public.frequency, integer)', 'execute'),
    'members change items from a date';
  assert not has_function_privilege('authenticated', 'public.household_spend_resolution(uuid, boolean, date, date, uuid[])', 'execute'),
    'the unmasked resolver is internal';
  assert not has_function_privilege('authenticated', 'public.budget_line_has_counted_spend(uuid)', 'execute'),
    'the household-wide spend check is internal';
  assert not has_function_privilege('authenticated', 'public.write_household_default_budget_line(uuid, date, uuid)', 'execute'),
    'the default writer is internal';
  assert not has_table_privilege('authenticated', 'public.household_default_budget_line', 'insert'),
    'members write the default only through the RPCs';
end $$;

rollback;
