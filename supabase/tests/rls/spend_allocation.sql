-- Assertions for spend allocation: member choices, versioned rules, defaults,
-- and the reads over them.
--
-- A household's real spending: rent is a fixed-amount Pay Anyone payment to the
-- landlord, and other payments to the same payee are not rent; water and
-- electricity go to that payee from their savers or with a note saying which;
-- gym is Planet Fitness; groceries are Woolworths plus a servo purchase a member
-- sends there; Up's gifts-and-charity category counts toward Gifts but a
-- charity payment is sent to Not budgeted. Spend no rule catches counts toward
-- the default item, or toward its member's allowance from their own account.
--
-- Resolution precedence (member choice over rules over default), rule versions
-- in force at posting time (an edit, a reorder, or a retirement leaves earlier
-- transactions as they were; a backdate moves them), the preview changing
-- nothing, pending and settled spend told apart, transfers and uncategorised
-- income left out, refunds netting off, an allocation following its
-- transaction's amount, and privacy: a co-member's private account never
-- counts, a rule or choice targeting an allowance (or a line drawn from one) is
-- its member's alone and reads to a co-member as that member's allowance,
-- unnamed, and another household sees nothing.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '86800000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alloc-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '86800000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'alloc-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '86800000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'alloc-carol@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"86800000-0000-0000-0000-000000000001","email":"alloc-alice@example.com"}', true);
select public.create_household('Alloc Household', 'Alice') as hid \gset
select set_config('sa.hid', :'hid', false);
select id as amid from public.members where household_id = :'hid'::uuid \gset
select set_config('sa.amid', :'amid', false);
select invite_code as code from public.create_invite_code() \gset

select set_config('request.jwt.claims', '{"sub":"86800000-0000-0000-0000-000000000002","email":"alloc-bob@example.com"}', true);
select public.join_household(:'code', 'Bob');
select id as bmid from public.members where household_id = :'hid'::uuid and id <> :'amid'::uuid \gset
select set_config('sa.bmid', :'bmid', false);

select set_config('request.jwt.claims', '{"sub":"86800000-0000-0000-0000-000000000003","email":"alloc-carol@example.com"}', true);
select public.create_household('Carol Household', 'Carol') as chid \gset

reset role;

insert into public.accounts (household_id, owner_member_id, name, type, source, external_id) values
  (:'hid', null, 'Joint', 'transaction', 'up', 'sa-acc-joint'),
  (:'hid', null, 'Water saver', 'savings', 'up', 'sa-acc-water'),
  (:'hid', :'amid', 'Alice''s Spending', 'transaction', 'up', 'sa-acc-alice'),
  (:'hid', :'bmid', 'Bob''s Spending', 'transaction', 'up', 'sa-acc-bob'),
  (:'chid', null, 'Carol Joint', 'transaction', 'up', 'sa-acc-carol');
select id as joint from public.accounts where external_id = 'sa-acc-joint' \gset
select id as water_saver from public.accounts where external_id = 'sa-acc-water' \gset
select set_config('sa.water_saver', :'water_saver', false);
select id as alice_acc from public.accounts where external_id = 'sa-acc-alice' \gset
select id as bob_acc from public.accounts where external_id = 'sa-acc-bob' \gset
select id as carol_acc from public.accounts where external_id = 'sa-acc-carol' \gset

update public.member_allowance set amount_cents = 100_00, frequency = 'fortnightly' where member_id = :'amid';
insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, allowance_member_id) values
  (:'hid', 'needs', 'Rent', 2_000_00, 'monthly', null),
  (:'hid', 'needs', 'Water', 60_00, 'monthly', null),
  (:'hid', 'needs', 'Electricity', 120_00, 'quarterly', null),
  (:'hid', 'wants', 'Gym', 25_00, 'monthly', null),
  (:'hid', 'needs', 'Groceries', 200_00, 'fortnightly', null),
  (:'hid', 'wants', 'Gifts', 50_00, 'monthly', null),
  (:'hid', 'discretionary', 'Discretionary spend', 100_00, 'fortnightly', null),
  (:'hid', 'discretionary', 'Alice''s books', 20_00, 'monthly', :'amid'),
  (:'chid', 'needs', 'Carol groceries', 100_00, 'fortnightly', null);
select set_config('sa.rent', (select id::text from public.budget_line where name = 'Rent'), false);
select set_config('sa.water', (select id::text from public.budget_line where name = 'Water'), false);
select set_config('sa.power', (select id::text from public.budget_line where name = 'Electricity'), false);
select set_config('sa.gym', (select id::text from public.budget_line where name = 'Gym'), false);
select set_config('sa.groceries', (select id::text from public.budget_line where name = 'Groceries'), false);
select set_config('sa.gifts', (select id::text from public.budget_line where name = 'Gifts'), false);
select set_config('sa.disc', (select id::text from public.budget_line where name = 'Discretionary spend'), false);
select set_config('sa.books', (select id::text from public.budget_line where name = 'Alice''s books'), false);
select set_config('sa.carol_line', (select id::text from public.budget_line where name = 'Carol groceries'), false);

-- October 2026, Australia/Sydney (UTC+11).
insert into public.transactions
  (household_id, account_id, posted_at, amount_cents, description, kind, status, source, external_id, external_category, up_message, notes)
  values
  (:'hid', :'joint', '2026-10-01T01:00:00Z', -2_000_00, 'J Smith', 'expense', 'settled', 'up', 'sa-rent', null, null, null),
  (:'hid', :'joint', '2026-10-02T01:00:00Z', -150_00, 'J Smith', 'expense', 'settled', 'up', 'sa-landlord', null, null, null),
  (:'hid', :'water_saver', '2026-10-03T01:00:00Z', -80_00, 'J SMITH', 'expense', 'settled', 'up', 'sa-water-saver', null, null, null),
  (:'hid', :'joint', '2026-10-04T01:00:00Z', -60_00, 'J Smith', 'expense', 'settled', 'up', 'sa-water-note', null, null, 'Water bill Q3'),
  (:'hid', :'joint', '2026-10-05T01:00:00Z', -120_00, 'J Smith', 'expense', 'settled', 'up', 'sa-power-msg', null, 'Electricity', null),
  (:'hid', :'joint', '2026-10-06T01:00:00Z', -25_00, 'PLANET FITNESS NORTH', 'expense', 'settled', 'up', 'sa-gym', 'fitness-and-wellbeing', null, null),
  (:'hid', :'joint', '2026-10-07T01:00:00Z', -100_00, 'Woolworths 1234 Sydney', 'expense', 'settled', 'up', 'sa-woolies', 'groceries', null, null),
  (:'hid', :'joint', '2026-10-08T01:00:00Z', 20_00, 'Woolworths 1234 Sydney', 'income', 'settled', 'up', 'sa-woolies-refund', 'groceries', null, null),
  (:'hid', :'joint', '2026-10-09T01:00:00Z', -10_00, 'Woolworths Metro', 'expense', 'pending', 'up', 'sa-woolies-pending', 'groceries', null, null),
  (:'hid', :'joint', '2026-10-10T01:00:00Z', -6_00, '7-Eleven Newtown', 'expense', 'pending', 'up', 'sa-servo', 'fuel', null, null),
  (:'hid', :'joint', '2026-10-11T01:00:00Z', -50_00, 'Myer', 'expense', 'settled', 'up', 'sa-gift', 'gifts-and-charity', null, null),
  (:'hid', :'joint', '2026-10-12T01:00:00Z', -30_00, 'Red Cross', 'expense', 'settled', 'up', 'sa-charity', 'gifts-and-charity', null, null),
  (:'hid', :'joint', '2026-10-13T01:00:00Z', -15_00, 'Cafe Sydney', 'expense', 'settled', 'up', 'sa-cafe', 'restaurants-and-cafes', null, null),
  (:'hid', :'joint', '2026-10-14T01:00:00Z', -20_00, 'Steam', 'expense', 'settled', 'up', 'sa-steam', 'games-and-software', null, null),
  (:'hid', :'joint', '2026-10-15T01:00:00Z', -12_00, 'Kindle', 'expense', 'settled', 'up', 'sa-kindle', 'news-magazines-and-books', null, null),
  (:'hid', :'alice_acc', '2026-10-16T01:00:00Z', -40_00, 'Bookshop', 'expense', 'settled', 'up', 'sa-alice-book', 'news-magazines-and-books', null, null),
  (:'hid', :'bob_acc', '2026-10-17T01:00:00Z', -35_00, 'Pub', 'expense', 'settled', 'up', 'sa-bob-pub', 'pubs-and-bars', null, null),
  (:'hid', :'joint', '2026-10-18T01:00:00Z', -80_00, 'Transfer to Water saver', 'transfer', 'settled', 'up', 'sa-transfer', null, null, null),
  (:'hid', :'joint', '2026-10-19T01:00:00Z', 3_000_00, 'Employer', 'income', 'settled', 'up', 'sa-pay', null, null, null),
  (:'chid', :'carol_acc', '2026-10-13T01:00:00Z', -9_00, 'Cafe', 'expense', 'settled', 'up', 'sa-carol', 'restaurants-and-cafes', null, null);

-- ── Alice: the default item, rules backdated to September ─────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"86800000-0000-0000-0000-000000000001","email":"alloc-alice@example.com"}', true);

do $$ begin
  begin
    perform public.set_household_default_budget_line(current_setting('sa.books')::uuid);
    raise exception 'a line drawn from an allowance must not be the default item';
  exception when check_violation then
    assert sqlerrm = 'default_budget_line_invalid', sqlerrm;
  end;
  perform public.set_household_default_budget_line(current_setting('sa.disc')::uuid);

  begin
    insert into public.spend_rule (household_id, target_kind) values (current_setting('sa.hid')::uuid, 'not_budgeted');
    raise exception 'rules must be written only through the RPCs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_spend_rule('not_budgeted');
    raise exception 'a rule needs a condition';
  exception when check_violation then
    assert sqlerrm = 'spend_rule_condition_required', sqlerrm;
  end;
  begin
    perform public.create_spend_rule('not_budgeted', p_amount_cents => 10_00, p_amount_min_cents => 5_00);
    raise exception 'an exact amount excludes a range';
  exception when check_violation then
    assert sqlerrm = 'spend_rule_amount_invalid', sqlerrm;
  end;
  begin
    perform public.create_spend_rule('not_budgeted', p_description_pattern => 'x', p_apply_from => current_date + 2);
    raise exception 'a rule cannot apply from a future day';
  exception when check_violation then
    assert sqlerrm = 'spend_rule_apply_from_future', sqlerrm;
  end;
  begin
    perform public.create_spend_rule('allowance', p_allowance_member_id => current_setting('sa.bmid')::uuid, p_description_pattern => 'x');
    raise exception 'a rule cannot target a co-member''s allowance';
  exception when check_violation then
    assert sqlerrm = 'spend_target_invalid', sqlerrm;
  end;
  begin
    perform public.create_spend_rule('budget_line', p_budget_line_id => current_setting('sa.carol_line')::uuid, p_description_pattern => 'x');
    raise exception 'a rule cannot target another household''s line';
  exception when check_violation then
    assert sqlerrm = 'spend_target_invalid', sqlerrm;
  end;

  -- Rent: the landlord's name exactly, at the rent amount.
  perform set_config('sa.r_rent', public.create_spend_rule('budget_line', current_setting('sa.rent')::uuid,
    p_description_pattern => 'j smith', p_description_match => 'equals', p_amount_cents => 2_000_00,
    p_apply_from => '2026-09-01')::text, false);
  -- Water: the landlord from the water saver, or a note saying water.
  perform set_config('sa.r_water_saver', public.create_spend_rule('budget_line', current_setting('sa.water')::uuid,
    p_description_pattern => 'smith', p_account_ids => array[current_setting('sa.water_saver')::uuid],
    p_apply_from => '2026-09-01')::text, false);
  perform set_config('sa.r_water_note', public.create_spend_rule('budget_line', current_setting('sa.water')::uuid,
    p_text_pattern => 'water', p_apply_from => '2026-09-01')::text, false);
  -- Electricity: a message or note saying electricity.
  perform set_config('sa.r_power', public.create_spend_rule('budget_line', current_setting('sa.power')::uuid,
    p_text_pattern => '  ELECTRICITY ', p_apply_from => '2026-09-01')::text, false);
  perform set_config('sa.r_gym', public.create_spend_rule('budget_line', current_setting('sa.gym')::uuid,
    p_description_pattern => 'Planet Fitness', p_apply_from => '2026-09-01')::text, false);
  perform set_config('sa.r_groceries', public.create_spend_rule('budget_line', current_setting('sa.groceries')::uuid,
    p_description_pattern => 'woolworths', p_apply_from => '2026-09-01')::text, false);
  perform set_config('sa.r_gifts', public.create_spend_rule('budget_line', current_setting('sa.gifts')::uuid,
    p_up_category_ids => array['gifts-and-charity'], p_apply_from => '2026-09-01')::text, false);

  assert (select text_pattern from public.current_spend_rules where id = current_setting('sa.r_power')::uuid) = 'ELECTRICITY',
    'a pattern is stored trimmed';
  assert (select array_agg(sort_order order by sort_order) from public.current_spend_rules) = array[0, 1, 2, 3, 4, 5, 6],
    'each new rule joins the end of the order';

  -- The servo purchase counts toward groceries; the charity payment toward nothing.
  perform public.set_transaction_spend_target((select id from public.transactions where external_id = 'sa-servo'),
    'budget_line', current_setting('sa.groceries')::uuid);
  perform public.set_transaction_spend_target((select id from public.transactions where external_id = 'sa-charity'), 'not_budgeted');
  -- A joint purchase toward a line drawn from her own allowance.
  perform public.set_transaction_spend_target((select id from public.transactions where external_id = 'sa-kindle'),
    'budget_line', current_setting('sa.books')::uuid);

  begin
    perform public.set_transaction_spend_target((select id from public.transactions where external_id = 'sa-transfer'), 'not_budgeted');
    raise exception 'a transfer is not spend';
  exception when check_violation then
    assert sqlerrm = 'transaction_not_spend', sqlerrm;
  end;
  begin
    perform public.set_transaction_spend_target((select id from public.transactions where external_id = 'sa-pay'), 'not_budgeted');
    raise exception 'uncategorised income is not spend';
  exception when check_violation then
    assert sqlerrm = 'transaction_not_spend', sqlerrm;
  end;
  begin
    perform public.set_transaction_spend_target((select id from public.transactions where external_id = 'sa-cafe'),
      'allowance', null, current_setting('sa.bmid')::uuid);
    raise exception 'spend cannot be sent to a co-member''s allowance';
  exception when check_violation then
    assert sqlerrm = 'spend_target_invalid', sqlerrm;
  end;
end $$;

-- Bob's private rule: Steam counts toward his allowance.
select set_config('request.jwt.claims', '{"sub":"86800000-0000-0000-0000-000000000002","email":"alloc-bob@example.com"}', true);
do $$ begin
  perform set_config('sa.r_steam', public.create_spend_rule('allowance', null, current_setting('sa.bmid')::uuid,
    p_description_pattern => 'steam', p_apply_from => '2026-09-01')::text, false);

  begin
    perform public.set_transaction_spend_target((select id from public.transactions where external_id = 'sa-cafe'),
      'budget_line', current_setting('sa.books')::uuid);
    raise exception 'spend cannot be sent to a line drawn from a co-member''s allowance';
  exception when check_violation then
    assert sqlerrm = 'spend_target_invalid', sqlerrm;
  end;
end $$;

-- ── Alice: where October counts ───────────────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"86800000-0000-0000-0000-000000000001","email":"alloc-alice@example.com"}', true);
do $$
declare
  r record;
  v_spent bigint;
begin
  -- Rent is the landlord at the rent amount; his other payment is not rent.
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-rent')]);
  assert r.target_kind = 'budget_line' and r.budget_line_id = current_setting('sa.rent')::uuid
    and r.reason = 'rule' and r.rule_id = current_setting('sa.r_rent')::uuid and r.rule_version = 1 and r.amount_cents = 2_000_00,
    format('rent: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-landlord')]);
  assert r.budget_line_id = current_setting('sa.disc')::uuid and r.reason = 'default',
    format('another payment to the landlord falls to the default item: %s', r);

  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-water-saver')]);
  assert r.budget_line_id = current_setting('sa.water')::uuid and r.rule_id = current_setting('sa.r_water_saver')::uuid,
    format('the landlord from the water saver is water: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-water-note')]);
  assert r.budget_line_id = current_setting('sa.water')::uuid and r.rule_id = current_setting('sa.r_water_note')::uuid,
    format('a household note saying water is water: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-power-msg')]);
  assert r.budget_line_id = current_setting('sa.power')::uuid, format('an Up message saying electricity is electricity: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-gym')]);
  assert r.budget_line_id = current_setting('sa.gym')::uuid, format('Planet Fitness is the gym, whatever its case: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-servo')]);
  assert r.budget_line_id = current_setting('sa.groceries')::uuid and r.reason = 'member_choice' and r.status = 'pending',
    format('the servo counts toward groceries by member choice, pending: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-charity')]);
  assert r.target_kind = 'not_budgeted' and r.reason = 'member_choice',
    format('a member''s choice beats the gifts rule: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-alice-book')]);
  assert r.target_kind = 'allowance' and r.allowance_member_id = current_setting('sa.amid')::uuid and r.reason = 'default',
    format('uncaught spend from her own account counts toward her allowance: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-steam')]);
  assert r.target_kind = 'allowance' and r.allowance_member_id = current_setting('sa.bmid')::uuid
    and r.reason = 'rule' and r.rule_id is null and r.rule_version is null and r.budget_line_id is null,
    format('a co-member''s private rule reads as their allowance, unnamed: %s', r);

  assert not exists (select 1 from public.spend_resolution() where transaction_id in (
      select id from public.transactions where external_id in ('sa-transfer', 'sa-pay'))),
    'transfers and uncategorised income never count';
  assert (select count(*) from public.spend_resolution('2026-10-01', '2026-10-31')) = 16,
    'every visible spend transaction resolves once, Bob''s private account and Carol''s household excluded';

  -- Spend per target, pending told apart.
  for r in select * from public.actual_spend_by_target('2026-10-01', '2026-10-31') loop
    v_spent := case
      when r.budget_line_id = current_setting('sa.rent')::uuid then 2_000_00
      when r.budget_line_id = current_setting('sa.water')::uuid then 80_00 + 60_00
      when r.budget_line_id = current_setting('sa.power')::uuid then 120_00
      when r.budget_line_id = current_setting('sa.gym')::uuid then 25_00
      when r.budget_line_id = current_setting('sa.groceries')::uuid and r.status = 'settled' then 100_00 - 20_00
      when r.budget_line_id = current_setting('sa.groceries')::uuid and r.status = 'pending' then 10_00 + 6_00
      when r.budget_line_id = current_setting('sa.gifts')::uuid then 50_00
      when r.budget_line_id = current_setting('sa.disc')::uuid then 150_00 + 15_00
      when r.budget_line_id = current_setting('sa.books')::uuid then 12_00
      when r.target_kind = 'not_budgeted' then 30_00
      when r.allowance_member_id = current_setting('sa.amid')::uuid then 40_00
      when r.allowance_member_id = current_setting('sa.bmid')::uuid then 20_00
    end;
    assert r.spent_cents = v_spent, format('actual spend for %s: %s, expected %s', r, r.spent_cents, v_spent);
  end loop;
  assert (select count(*) from public.actual_spend_by_target('2026-10-01', '2026-10-31')) = 12,
    'one row per target and status';
  assert (select transaction_count from public.actual_spend_by_target('2026-10-01', '2026-10-31')
      where budget_line_id = current_setting('sa.groceries')::uuid and status = 'settled') = 2,
    'a refund nets off the target its purchase counts toward';

  assert exists (select 1 from public.transaction_allocation where budget_line_id = current_setting('sa.books')::uuid),
    'Alice reads her own choice toward her drawn line';
  assert not exists (select 1 from public.spend_rule where id = current_setting('sa.r_steam')::uuid),
    'Bob''s allowance rule is invisible to Alice';
  begin
    perform public.update_spend_rule(current_setting('sa.r_steam')::uuid, p_description_pattern => 'x');
    raise exception 'Alice must not edit Bob''s private rule';
  exception when no_data_found then
    assert sqlerrm = 'spend_rule_not_found', sqlerrm;
  end;
  begin
    perform public.delete_spend_rule(current_setting('sa.r_steam')::uuid);
    raise exception 'Alice must not retire Bob''s private rule';
  exception when no_data_found then null;
  end;
  begin
    perform public.set_transaction_spend_target((select id from public.transactions t where t.external_id = 'sa-bob-pub'), 'not_budgeted');
    raise exception 'Alice must not allocate Bob''s private spending';
  exception when no_data_found then null;
  end;
end $$;

-- ── Bob: the joint account and his own ────────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"86800000-0000-0000-0000-000000000002","email":"alloc-bob@example.com"}', true);
do $$
declare
  r record;
begin
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-kindle')]);
  assert r.target_kind = 'allowance' and r.allowance_member_id = current_setting('sa.amid')::uuid
    and r.budget_line_id is null and r.reason = 'member_choice',
    format('a co-member''s choice toward her drawn line reads as her allowance: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-steam')]);
  assert r.rule_id = current_setting('sa.r_steam')::uuid and r.allowance_member_id = current_setting('sa.bmid')::uuid,
    format('Bob reads his own rule: %s', r);

  assert (select spent_cents from public.actual_spend_by_target('2026-10-01', '2026-10-31')
      where target_kind = 'allowance' and allowance_member_id = current_setting('sa.bmid')::uuid) = 35_00 + 20_00,
    'Bob''s allowance holds his private account''s spend and his rule''s';
  assert (select spent_cents from public.actual_spend_by_target('2026-10-01', '2026-10-31')
      where target_kind = 'allowance' and allowance_member_id = current_setting('sa.amid')::uuid) = 12_00,
    'Alice''s private account never counts for Bob';
  assert not exists (select 1 from public.actual_spend_by_target('2026-10-01', '2026-10-31')
      where budget_line_id = current_setting('sa.books')::uuid),
    'Alice''s drawn line is never named to Bob';
  assert not exists (select 1 from public.transaction_allocation
      where transaction_id = (select id from public.transactions where external_id = 'sa-kindle')),
    'Bob cannot read Alice''s choice toward her drawn line';
  assert (select count(*) from public.current_spend_rules) = 8, 'Bob reads the household rules and his own';
end $$;

-- ── Carol: her own household, no default item ─────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"86800000-0000-0000-0000-000000000003","email":"alloc-carol@example.com"}', true);
do $$
declare
  r record;
begin
  assert (select count(*) from public.spend_rule) = 0, 'another household''s rules are invisible';
  assert (select count(*) from public.spend_rule_version) = 0, 'another household''s rule versions are invisible';
  assert (select count(*) from public.transaction_allocation) = 0, 'another household''s allocations are invisible';
  select * into r from public.spend_resolution();
  assert (select count(*) from public.spend_resolution()) = 1 and r.target_kind = 'not_budgeted' and r.reason = 'default',
    format('with no default item, uncaught spend is Not budgeted: %s', r);
  begin
    perform public.set_transaction_spend_target((select id from public.transactions where external_id = 'sa-cafe'), 'not_budgeted');
    raise exception 'Carol must not allocate another household''s transaction';
  exception when no_data_found then null;
  end;
end $$;

-- ── Versions: an edit applies from now ────────────────────────────────────────

reset role;
insert into public.transactions
  (household_id, account_id, posted_at, amount_cents, description, kind, status, source, external_id, external_category)
  values
  (:'hid', :'joint', now() + interval '1 day', -25_00, 'Planet Fitness', 'expense', 'pending', 'up', 'sa-gym-later', 'fitness-and-wellbeing'),
  (:'hid', :'joint', now() + interval '1 day', -30_00, 'Anytime Fitness', 'expense', 'pending', 'up', 'sa-anytime-later', 'fitness-and-wellbeing'),
  (:'hid', :'joint', now() + interval '1 day', -40_00, 'Woolworths', 'expense', 'pending', 'up', 'sa-woolies-later', 'groceries');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"86800000-0000-0000-0000-000000000001","email":"alloc-alice@example.com"}', true);
do $$
declare
  r record;
  v_steam_order integer;
begin
  assert public.update_spend_rule(current_setting('sa.r_gym')::uuid, p_description_pattern => 'anytime fitness') = 2,
    'an edit is the rule''s next version';

  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-gym')]);
  assert r.budget_line_id = current_setting('sa.gym')::uuid and r.rule_version = 1,
    format('an earlier transaction keeps the version it matched: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-gym-later')]);
  assert r.reason = 'default', format('a later one is held to the edited version: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-anytime-later')]);
  assert r.budget_line_id = current_setting('sa.gym')::uuid and r.rule_version = 2, format('the edited version matches from now: %s', r);

  -- Reordering applies from now too.
  perform set_config('sa.r_woolies_none', public.create_spend_rule('not_budgeted', p_description_pattern => 'woolworths')::text, false);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-woolies-later')]);
  assert r.budget_line_id = current_setting('sa.groceries')::uuid, format('the earlier rule in the order wins: %s', r);

  begin
    perform public.reorder_spend_rules(array[current_setting('sa.r_rent')::uuid]);
    raise exception 'a reorder must name every visible live rule';
  exception when check_violation then
    assert sqlerrm = 'spend_rule_order_mismatch', sqlerrm;
  end;

  select sort_order into v_steam_order from public.spend_rule_version where rule_id = current_setting('sa.r_steam')::uuid;
  assert v_steam_order is null, 'Alice cannot read Bob''s rule''s place';

  perform public.reorder_spend_rules(array[
    current_setting('sa.r_rent'), current_setting('sa.r_water_saver'), current_setting('sa.r_water_note'),
    current_setting('sa.r_power'), current_setting('sa.r_gym'), current_setting('sa.r_woolies_none'),
    current_setting('sa.r_groceries'), current_setting('sa.r_gifts')
  ]::uuid[]);

  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-woolies-later')]);
  assert r.target_kind = 'not_budgeted' and r.rule_id = current_setting('sa.r_woolies_none')::uuid,
    format('after the reorder a later transaction meets the moved rule first: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-woolies')]);
  assert r.budget_line_id = current_setting('sa.groceries')::uuid and r.rule_version = 1,
    format('an earlier transaction keeps the order it resolved under: %s', r);
  assert (select count(*) from public.spend_rule_version where rule_id = current_setting('sa.r_rent')::uuid) = 1,
    'a rule the reorder left in place gains no version';
end $$;

reset role;
do $$ begin
  assert (select sort_order from public.spend_rule_version
      where rule_id = current_setting('sa.r_steam')::uuid and valid_until is null) = 7,
    'a co-member''s private rule keeps its place through a reorder';
end $$;

-- ── Preview and backdating ────────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"86800000-0000-0000-0000-000000000001","email":"alloc-alice@example.com"}', true);
do $$
declare
  r record;
  v_rules integer := (select count(*) from public.spend_rule_version);
begin
  assert (select count(*) from public.preview_spend_rule(p_target_kind => 'budget_line',
      p_budget_line_id => current_setting('sa.groceries')::uuid, p_description_pattern => 'cafe')) = 0,
    'a rule from now moves nothing already posted';

  select * into r from public.preview_spend_rule(p_target_kind => 'budget_line',
    p_budget_line_id => current_setting('sa.groceries')::uuid, p_description_pattern => 'cafe', p_apply_from => '2026-09-01');
  assert (select count(*) from public.preview_spend_rule(p_target_kind => 'budget_line',
      p_budget_line_id => current_setting('sa.groceries')::uuid, p_description_pattern => 'cafe', p_apply_from => '2026-09-01')) = 1
    and r.transaction_id = (select id from public.transactions where external_id = 'sa-cafe')
    and r.from_budget_line_id = current_setting('sa.disc')::uuid and r.from_reason = 'default'
    and r.to_budget_line_id = current_setting('sa.groceries')::uuid and r.to_reason = 'rule'
    and r.to_rule_id is not null and r.amount_cents = 15_00,
    format('a backdated rule previews the cafe moving from the default item to groceries, and Carol''s cafe not at all: %s', r);
  assert (select count(*) from public.spend_rule_version) = v_rules, 'a preview changes nothing';

  assert (select count(*) from public.preview_spend_rule(current_setting('sa.r_groceries')::uuid,
      p_retire => true, p_apply_from => '2026-09-01')) = 3,
    'retiring groceries from September moves its purchase, refund and pending row, never a member''s choice';
  assert (select count(*) from public.preview_spend_rule(p_target_kind => 'not_budgeted',
      p_up_category_ids => array['pubs-and-bars'], p_apply_from => '2026-09-01')) = 0,
    'a preview never reaches a co-member''s private account';
  begin
    perform public.preview_spend_rule(p_target_kind => 'not_budgeted');
    raise exception 'a preview raises what the change would';
  exception when check_violation then
    assert sqlerrm = 'spend_rule_condition_required', sqlerrm;
  end;

  -- A backdated edit re-resolves since its day: rent at a new amount from October.
  perform public.update_spend_rule(current_setting('sa.r_rent')::uuid, p_description_pattern => 'j smith',
    p_description_match => 'equals', p_amount_cents => 150_00, p_apply_from => '2026-10-02');
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-landlord')]);
  assert r.budget_line_id = current_setting('sa.rent')::uuid and r.rule_version = 2,
    format('the backdated version applies from its day: %s', r);
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-rent')]);
  assert r.budget_line_id = current_setting('sa.rent')::uuid and r.rule_version = 1,
    format('a transaction before it keeps the earlier version: %s', r);

  -- Retiring from now keeps history; retiring from before it applied removes it.
  perform public.delete_spend_rule(current_setting('sa.r_water_note')::uuid);
  assert not exists (select 1 from public.current_spend_rules where id = current_setting('sa.r_water_note')::uuid),
    'a retired rule is no longer live';
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-water-note')]);
  assert r.budget_line_id = current_setting('sa.water')::uuid, format('earlier transactions keep a retired rule: %s', r);
  begin
    perform public.update_spend_rule(current_setting('sa.r_water_note')::uuid, p_text_pattern => 'water');
    raise exception 'a retired rule cannot be edited';
  exception when check_violation then
    assert sqlerrm = 'spend_rule_retired', sqlerrm;
  end;

  perform public.delete_spend_rule(current_setting('sa.r_power')::uuid, '2026-09-01');
  assert not exists (select 1 from public.spend_rule where id = current_setting('sa.r_power')::uuid),
    'a rule retired from before it first applied is removed';
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-power-msg')]);
  assert r.reason = 'default', format('its transactions fall back: %s', r);

  -- Clearing a choice returns the transaction to the rules.
  perform public.clear_transaction_spend_target((select id from public.transactions where external_id = 'sa-charity'));
  select * into r from public.spend_resolution(p_transaction_ids => array[(select id from public.transactions where external_id = 'sa-charity')]);
  assert r.budget_line_id = current_setting('sa.gifts')::uuid and r.reason = 'rule', format('a cleared choice falls to the rules: %s', r);
end $$;

-- ── Allocation sets follow their transaction ──────────────────────────────────

reset role;
do $$
declare
  v_servo uuid := (select id from public.transactions where external_id = 'sa-servo');
  v_cafe uuid := (select id from public.transactions where external_id = 'sa-cafe');
begin
  update public.transactions set amount_cents = -7_50, status = 'settled' where id = v_servo;
  assert (select amount_cents from public.transaction_allocation where transaction_id = v_servo) = 7_50,
    'a whole-transaction choice takes the settled amount';

  insert into public.transaction_allocation (household_id, transaction_id, target_kind, budget_line_id, amount_cents, origin)
    values (current_setting('sa.hid')::uuid, v_cafe, 'budget_line', current_setting('sa.groceries')::uuid, 10_00, 'member_choice'),
      (current_setting('sa.hid')::uuid, v_cafe, 'not_budgeted', null, 5_00, 'member_choice');
  set constraints check_transaction_allocation immediate;
  set constraints check_transaction_allocation deferred;

  update public.transactions set amount_cents = -31_00 where id = v_cafe;
  assert (select array_agg(amount_cents order by amount_cents) from public.transaction_allocation where transaction_id = v_cafe)
    = array[10_33, 20_67]::bigint[],
    'a split scales with its transaction, the remainder on its largest row';

  begin
    update public.transaction_allocation set amount_cents = 1_00 where transaction_id = v_cafe and target_kind = 'not_budgeted';
    set constraints check_transaction_allocation immediate;
    raise exception 'a set must sum to its spend';
  exception when check_violation then
    assert sqlerrm = 'transaction_allocation_mismatch', sqlerrm;
  end;
  set constraints check_transaction_allocation deferred;

  begin
    insert into public.transaction_allocation (household_id, transaction_id, target_kind, amount_cents, origin)
      values (current_setting('sa.hid')::uuid, v_servo, 'not_budgeted', 0, 'suggestion');
    set constraints check_transaction_allocation immediate;
    raise exception 'a set holds one origin';
  exception when check_violation then
    assert sqlerrm = 'transaction_allocation_mismatch', sqlerrm;
  end;
  set constraints check_transaction_allocation deferred;

  delete from public.budget_line where id = current_setting('sa.groceries')::uuid;
  assert not exists (select 1 from public.transaction_allocation where transaction_id = v_cafe),
    'a set losing a row to a deleted line is discarded whole';
  assert not exists (select 1 from public.spend_rule where id = current_setting('sa.r_groceries')::uuid),
    'a rule goes with its line';
end $$;

-- ── Grants ────────────────────────────────────────────────────────────────────

do $$ begin
  assert not has_function_privilege('anon', 'public.spend_resolution(date, date, uuid[])', 'execute'),
    'anon cannot resolve spend';
  assert not has_function_privilege('authenticated', 'public.write_spend_rule_version(uuid, timestamptz, integer, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text)', 'execute'),
    'the version writer is internal';
  assert not has_function_privilege('authenticated', 'public.assert_spend_target(uuid, public.spend_target_kind, uuid, uuid)', 'execute'),
    'the target check is internal';
  assert not has_table_privilege('authenticated', 'public.transaction_allocation', 'insert'),
    'members write allocations only through the RPCs';
end $$;

rollback;
