-- Equivalence assertions for the derived-budget-line triggers.
--
-- The reconcile triggers (20260807000000) must compute the identical budget_line
-- tuple the client reconciler does, or the two would fight on live data. Each
-- scenario below drives a source change and asserts the FULL derived tuple
-- (line_group, name, amount_cents, frequency, interval_count, goal_id,
-- breakdown_id, destination_account_id, gift_recipient_member_id, is_gift_line)
-- the trigger produces. Runs as authenticated users with simulated JWTs so it
-- exercises the real policies and grants; any failed assertion aborts the script
-- (psql ON_ERROR_STOP). Wrapped in a transaction and rolled back.

\set ON_ERROR_STOP on
begin;

-- Six users across three households: Trigora (generic + gift scenarios), Solo
-- (member-add / buyer-account scenarios), and Duo (member-removal scenario).
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ada@example.com'),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ben@example.com'),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cleo@example.com'),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'dan@example.com'),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'eve@example.com'),
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'finn@example.com');

set local role authenticated;

-- ══ Trigora: two members, Ben and Ada each with a spending account ════════════
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","email":"ada@example.com"}', true);
select public.create_household('Trigora', 'Ada') as t_hid \gset
select set_config('t.hid', :'t_hid', false);
select invite_code as t_code from public.create_invite_code() \gset
select set_config('t.code', :'t_code', false);

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000002","email":"ben@example.com"}', true);
select public.join_household(current_setting('t.code'), 'Ben');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","email":"ada@example.com"}', true);
select id as t_mid_ada from public.members
  where household_id = current_setting('t.hid')::uuid and user_id = 'a0000000-0000-0000-0000-000000000001' \gset
select set_config('t.mid_ada', :'t_mid_ada', false);
select id as t_mid_ben from public.members
  where household_id = current_setting('t.hid')::uuid and user_id = 'b0000000-0000-0000-0000-000000000002' \gset
select set_config('t.mid_ben', :'t_mid_ben', false);

-- Ada owns a spending account; Ben owns his (each buys the other's gifts).
insert into public.accounts (household_id, owner_member_id, name, type)
  values (current_setting('t.hid')::uuid, current_setting('t.mid_ada')::uuid, 'Ada Spend', 'transaction')
  returning id as t_ada_spend \gset
select set_config('t.ada_spend', :'t_ada_spend', false);

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000002","email":"ben@example.com"}', true);
insert into public.accounts (household_id, owner_member_id, name, type)
  values (current_setting('t.hid')::uuid, current_setting('t.mid_ben')::uuid, 'Ben Spend', 'transaction')
  returning id as t_ben_spend \gset
select set_config('t.ben_spend', :'t_ben_spend', false);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","email":"ada@example.com"}', true);

-- ── Scenario 1: generic breakdown, add first item → derived line minted ───────
insert into public.breakdown (household_id, name, line_group)
  values (current_setting('t.hid')::uuid, 'Meds', 'needs')
  returning id as t_bd1 \gset
select set_config('t.bd1', :'t_bd1', false);

insert into public.breakdown_item (household_id, breakdown_id, name, amount_cents, frequency)
  values (current_setting('t.hid')::uuid, current_setting('t.bd1')::uuid, 'Script', 10_00, 'weekly')
  returning id as t_bd1_item \gset
select set_config('t.bd1_item', :'t_bd1_item', false);

do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line where breakdown_id = current_setting('t.bd1')::uuid;
  assert r.line_group = 'needs', 'S1 group';
  assert r.name = 'Meds', 'S1 name';
  assert r.amount_cents = 520_00, format('S1 amount weekly*52, got %s', r.amount_cents);
  assert r.frequency = 'annual', 'S1 frequency';
  assert r.interval_count is null, 'S1 interval_count';
  assert r.goal_id is null, 'S1 goal_id';
  assert r.destination_account_id is null, 'S1 destination';
  assert r.gift_recipient_member_id is null, 'S1 gift member';
  assert r.is_gift_line = false, 'S1 is_gift_line';
end $$;

-- ── Scenario 2: update item amount + frequency + interval (rounded roll-up) ───
update public.breakdown_item
  set amount_cents = 10_00, frequency = 'every_n_weeks', interval_count = 3
  where id = current_setting('t.bd1_item')::uuid;

do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line where breakdown_id = current_setting('t.bd1')::uuid;
  -- floor(1000 * 52 / 3 + 0.5) = floor(17333.833) = 17333
  assert r.amount_cents = 17333, format('S2 every_n_weeks rounded, got %s', r.amount_cents);
  assert r.frequency = 'annual', 'S2 frequency stamped annual';
  assert r.interval_count is null, 'S2 interval_count null';
end $$;

-- ── Scenario 6: rename the breakdown → derived line name follows ──────────────
update public.breakdown set name = 'Medications' where id = current_setting('t.bd1')::uuid;
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line where breakdown_id = current_setting('t.bd1')::uuid;
  assert r.name = 'Medications', format('S6 renamed, got %s', r.name);
end $$;

-- ── Scenario 5: breakdown group → savings clears the derived line's routing ───
-- The user first routes the (needs) line to an account; moving the breakdown to a
-- goal-routed group must force the destination to null (the DB CHECK bars it).
update public.budget_line set destination_account_id = current_setting('t.ada_spend')::uuid
  where breakdown_id = current_setting('t.bd1')::uuid;
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line where breakdown_id = current_setting('t.bd1')::uuid;
  assert r.destination_account_id = current_setting('t.ada_spend')::uuid, 'S5 pre: routing set on a needs line';
end $$;

update public.breakdown set line_group = 'savings' where id = current_setting('t.bd1')::uuid;
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line where breakdown_id = current_setting('t.bd1')::uuid;
  assert r.line_group = 'savings', 'S5 group savings';
  assert r.destination_account_id is null, 'S5 destination cleared under savings';
end $$;

-- ── Scenario 4: remove last item on a routed line → kept at $0 ────────────────
insert into public.breakdown (household_id, name, line_group)
  values (current_setting('t.hid')::uuid, 'Gym', 'wants')
  returning id as t_bd2 \gset
select set_config('t.bd2', :'t_bd2', false);
insert into public.breakdown_item (household_id, breakdown_id, name, amount_cents, frequency)
  values (current_setting('t.hid')::uuid, current_setting('t.bd2')::uuid, 'Membership', 50_00, 'monthly')
  returning id as t_bd2_item \gset
select set_config('t.bd2_item', :'t_bd2_item', false);
update public.budget_line set destination_account_id = current_setting('t.ada_spend')::uuid
  where breakdown_id = current_setting('t.bd2')::uuid;

delete from public.breakdown_item where id = current_setting('t.bd2_item')::uuid;
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line where breakdown_id = current_setting('t.bd2')::uuid;
  assert r.amount_cents = 0, format('S4 kept at $0, got %s', r.amount_cents);
  assert r.destination_account_id = current_setting('t.ada_spend')::uuid, 'S4 routing preserved';
  assert r.line_group = 'wants', 'S4 group';
end $$;

-- ── Scenario 3: remove last item on an unrouted line → line removed ───────────
insert into public.breakdown (household_id, name, line_group)
  values (current_setting('t.hid')::uuid, 'Books', 'discretionary')
  returning id as t_bd3 \gset
select set_config('t.bd3', :'t_bd3', false);
insert into public.breakdown_item (household_id, breakdown_id, name, amount_cents, frequency)
  values (current_setting('t.hid')::uuid, current_setting('t.bd3')::uuid, 'Novels', 20_00, 'monthly')
  returning id as t_bd3_item \gset
select set_config('t.bd3_item', :'t_bd3_item', false);
do $$ begin
  assert (select count(*) from public.budget_line where breakdown_id = current_setting('t.bd3')::uuid) = 1,
    'S3 pre: line exists';
end $$;

delete from public.breakdown_item where id = current_setting('t.bd3_item')::uuid;
do $$ begin
  assert (select count(*) from public.budget_line where breakdown_id = current_setting('t.bd3')::uuid) = 0,
    'S3 unrouted line removed';
end $$;

-- ── Gift scenarios: recipients and an occasion ───────────────────────────────
select id as t_rec_ada from public.gift_recipient
  where household_id = current_setting('t.hid')::uuid and member_id = current_setting('t.mid_ada')::uuid \gset
select set_config('t.rec_ada', :'t_rec_ada', false);
insert into public.gift_recipient (household_id, name)
  values (current_setting('t.hid')::uuid, 'Uncle')
  returning id as t_rec_uncle \gset
select set_config('t.rec_uncle', :'t_rec_uncle', false);
insert into public.gift_occasion (household_id, name)
  values (current_setting('t.hid')::uuid, 'Xmas')
  returning id as t_occ \gset
select set_config('t.occ', :'t_occ', false);

-- ── Scenario 7: gift budget for a member → "Gifts for <member>" funded by buyer
insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('t.hid')::uuid, current_setting('t.rec_ada')::uuid, current_setting('t.occ')::uuid, 300_00)
  returning id as t_gb_ada \gset
select set_config('t.gb_ada', :'t_gb_ada', false);

do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('t.mid_ada')::uuid;
  assert r.line_group = 'wants', 'S7 group seeded wants';
  assert r.name = 'Gifts for Ada', format('S7 name, got %s', r.name);
  assert r.amount_cents = 300_00, format('S7 amount, got %s', r.amount_cents);
  assert r.frequency = 'annual', 'S7 frequency';
  assert r.interval_count is null, 'S7 interval_count';
  assert r.goal_id is null, 'S7 goal_id';
  assert r.breakdown_id is null, 'S7 breakdown_id null';
  assert r.destination_account_id = current_setting('t.ben_spend')::uuid,
    'S7 funded by the buyer (Ben) account';
  assert r.gift_recipient_member_id = current_setting('t.mid_ada')::uuid, 'S7 member';
  assert r.is_gift_line = true, 'S7 is_gift_line';
end $$;

-- ── Scenario 8: gift budget for an external recipient → the null-member "Gifts"
insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('t.hid')::uuid, current_setting('t.rec_uncle')::uuid, current_setting('t.occ')::uuid, 150_00)
  returning id as t_gb_uncle \gset
select set_config('t.gb_uncle', :'t_gb_uncle', false);

do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id is null;
  assert r.line_group = 'wants', 'S8 group seeded wants';
  assert r.name = 'Gifts', format('S8 external name, got %s', r.name);
  assert r.amount_cents = 150_00, format('S8 amount, got %s', r.amount_cents);
  assert r.destination_account_id is null, 'S8 external unrouted by default';
  assert r.gift_recipient_member_id is null, 'S8 external null member';
  assert r.is_gift_line = true, 'S8 is_gift_line';
end $$;

-- ── Scenario 13: rename the member → "Gifts for <member>" follows ─────────────
update public.members set name = 'Adele' where id = current_setting('t.mid_ada')::uuid;
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('t.mid_ada')::uuid;
  assert r.name = 'Gifts for Adele', format('S13 name follows member rename, got %s', r.name);
end $$;

-- ── Scenario 16: a gift line's user-set group and routing survive an unrelated
-- re-derive. The external line is moved to discretionary and routed by the user;
-- an unrelated gift-budget edit must not touch either.
update public.budget_line
  set line_group = 'discretionary', destination_account_id = current_setting('t.ada_spend')::uuid
  where is_gift_line and gift_recipient_member_id is null;
update public.gift_budget set budgeted_amount_cents = 320_00 where id = current_setting('t.gb_ada')::uuid;
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id is null;
  assert r.line_group = 'discretionary', 'S16 group preserved across unrelated re-derive';
  assert r.destination_account_id = current_setting('t.ada_spend')::uuid, 'S16 routing preserved';
  assert r.amount_cents = 150_00, 'S16 external amount unchanged by member edit';
  -- The member line did pick up the edit, confirming the re-derive ran.
  assert (select amount_cents from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('t.mid_ada')::uuid) = 320_00,
    'S16 the member line reflects its own edit';
end $$;

-- ── Scenario 10: external partition emptied but routed → kept at $0 ───────────
delete from public.gift_budget where id = current_setting('t.gb_uncle')::uuid;
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id is null;
  assert r.amount_cents = 0, format('S10 external kept at $0, got %s', r.amount_cents);
  assert r.destination_account_id = current_setting('t.ada_spend')::uuid, 'S10 external routing preserved';
  assert r.line_group = 'discretionary', 'S10 external group preserved';
  assert r.is_gift_line = true, 'S10 still a gift line';
end $$;

-- ── Scenario 9: member partition emptied → line removed ───────────────────────
delete from public.gift_budget where id = current_setting('t.gb_ada')::uuid;
do $$ begin
  assert (select count(*) from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('t.mid_ada')::uuid) = 0,
    'S9 emptied member gift line removed';
end $$;

-- ── Scenario D0: the discretionary buffer alone drives the external partition
-- (no gift budgets remain after S9/S10); its amount folds straight into the
-- kept, routed external line, and the idempotency check below (S17) covers it.
insert into public.gift_discretionary_budget (household_id, budgeted_amount_cents)
  values (current_setting('t.hid')::uuid, 75_00)
  returning id as t_discretionary \gset
select set_config('t.discretionary', :'t_discretionary', false);
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id is null;
  assert r.amount_cents = 75_00,
    format('D0 external amount is the buffer alone (no budgets left), got %s', r.amount_cents);
  assert r.destination_account_id = current_setting('t.ada_spend')::uuid, 'D0 routing preserved';
end $$;

-- ── Scenario 17: idempotency — a fresh reconcile writes nothing ──────────────
-- Snapshot every derived line (including updated_at); re-running the engine over
-- the converged household must leave every row byte-for-byte identical.
select md5(coalesce(string_agg(
    bl.id || '|' || bl.line_group || '|' || bl.name || '|' || bl.amount_cents || '|' ||
    bl.frequency || '|' || coalesce(bl.interval_count::text, '') || '|' ||
    coalesce(bl.goal_id::text, '') || '|' || coalesce(bl.breakdown_id::text, '') || '|' ||
    coalesce(bl.destination_account_id::text, '') || '|' ||
    coalesce(bl.gift_recipient_member_id::text, '') || '|' || bl.is_gift_line || '|' ||
    bl.updated_at, ',' order by bl.id), '')) as t_before
  from public.budget_line bl where bl.household_id = current_setting('t.hid')::uuid \gset
select set_config('t.before', :'t_before', false);

reset role;
select public.reconcile_derived_lines(current_setting('t.hid')::uuid);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","email":"ada@example.com"}', true);

do $$
declare v_after text;
begin
  select md5(coalesce(string_agg(
      bl.id || '|' || bl.line_group || '|' || bl.name || '|' || bl.amount_cents || '|' ||
      bl.frequency || '|' || coalesce(bl.interval_count::text, '') || '|' ||
      coalesce(bl.goal_id::text, '') || '|' || coalesce(bl.breakdown_id::text, '') || '|' ||
      coalesce(bl.destination_account_id::text, '') || '|' ||
      coalesce(bl.gift_recipient_member_id::text, '') || '|' || bl.is_gift_line || '|' ||
      bl.updated_at, ',' order by bl.id), ''))
    into v_after
    from public.budget_line bl where bl.household_id = current_setting('t.hid')::uuid;
  assert v_after = current_setting('t.before'), 'S17 re-running reconcile changed nothing (no writes)';
end $$;

-- ══ Solo: a member gift line, a second member, then a buyer account ══════════
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000003","email":"cleo@example.com"}', true);
select public.create_household('Solo', 'Cleo') as s_hid \gset
select set_config('s.hid', :'s_hid', false);
select invite_code as s_code from public.create_invite_code() \gset
select set_config('s.code', :'s_code', false);
select id as s_mid_cleo from public.members
  where household_id = current_setting('s.hid')::uuid and user_id = 'c0000000-0000-0000-0000-000000000003' \gset
select set_config('s.mid_cleo', :'s_mid_cleo', false);
select id as s_rec_cleo from public.gift_recipient
  where household_id = current_setting('s.hid')::uuid and member_id = current_setting('s.mid_cleo')::uuid \gset
select set_config('s.rec_cleo', :'s_rec_cleo', false);
insert into public.gift_occasion (household_id, name)
  values (current_setting('s.hid')::uuid, 'Bday') returning id as s_occ \gset
select set_config('s.occ', :'s_occ', false);

-- A gift budget for the sole member: her gift line has no buyer yet, so it is
-- unrouted.
insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('s.hid')::uuid, current_setting('s.rec_cleo')::uuid, current_setting('s.occ')::uuid, 80_00);
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('s.mid_cleo')::uuid;
  assert r.name = 'Gifts for Cleo', 'Solo: member line minted';
  assert r.destination_account_id is null, 'Solo: sole-member gift line unrouted';
end $$;

-- ── Scenario 11: a second member joins → the gift line is re-derived. Dan has no
-- account yet, so the members trigger correctly leaves it unrouted.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000004","email":"dan@example.com"}', true);
select public.join_household(current_setting('s.code'), 'Dan');
select id as s_mid_dan from public.members
  where household_id = current_setting('s.hid')::uuid and user_id = 'd0000000-0000-0000-0000-000000000004' \gset
select set_config('s.mid_dan', :'s_mid_dan', false);
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('s.mid_cleo')::uuid;
  assert r.destination_account_id is null, 'S11 member-add re-derive: still unrouted (buyer has no account)';
end $$;

-- ── Scenario 14: the buyer's transaction account appears → funding resolves ───
insert into public.accounts (household_id, owner_member_id, name, type)
  values (current_setting('s.hid')::uuid, current_setting('s.mid_dan')::uuid, 'Dan Spend', 'transaction')
  returning id as s_dan_spend \gset
select set_config('s.dan_spend', :'s_dan_spend', false);
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('s.mid_cleo')::uuid;
  assert r.destination_account_id = current_setting('s.dan_spend')::uuid,
    'S14 buyer account appears → gift line funded from it';
end $$;

-- ── Scenario 15: the buyer's account renamed, changing name order → funding
-- switches to the new first-by-name account. Cleo (the buyer for Dan's line)
-- owns two accounts; the tiebreak is order by name, id.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000003","email":"cleo@example.com"}', true);
insert into public.accounts (household_id, owner_member_id, name, type)
  values (current_setting('s.hid')::uuid, current_setting('s.mid_cleo')::uuid, 'Cleo Beta', 'transaction')
  returning id as s_cleo_beta \gset
select set_config('s.cleo_beta', :'s_cleo_beta', false);
insert into public.accounts (household_id, owner_member_id, name, type)
  values (current_setting('s.hid')::uuid, current_setting('s.mid_cleo')::uuid, 'Cleo Alpha', 'transaction')
  returning id as s_cleo_alpha \gset
select set_config('s.cleo_alpha', :'s_cleo_alpha', false);
insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('s.hid')::uuid,
          (select id from public.gift_recipient where household_id = current_setting('s.hid')::uuid and member_id = current_setting('s.mid_dan')::uuid),
          current_setting('s.occ')::uuid, 60_00);
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('s.mid_dan')::uuid;
  assert r.destination_account_id = current_setting('s.cleo_alpha')::uuid,
    'S15 pre: funded by the name-first buyer account (Cleo Alpha)';
end $$;

update public.accounts set name = 'Cleo Zulu' where id = current_setting('s.cleo_alpha')::uuid;
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('s.mid_dan')::uuid;
  assert r.destination_account_id = current_setting('s.cleo_beta')::uuid,
    'S15 renamed account reorders → funding switches to Cleo Beta';
end $$;

-- ══ Discretionary: the ad hoc gift buffer folds into the external partition ═══
-- Continues in Solo, which has no external gift line yet — a blank slate that
-- isolates the buffer's own effect on that partition's existence and amount.

-- ── Scenario D1: a zero-amount buffer creates no line ─────────────────────────
insert into public.gift_discretionary_budget (household_id, budgeted_amount_cents)
  values (current_setting('s.hid')::uuid, 0)
  returning id as s_discretionary \gset
select set_config('s.discretionary', :'s_discretionary', false);
do $$ begin
  assert (select count(*) from public.budget_line
    where household_id = current_setting('s.hid')::uuid
      and is_gift_line and gift_recipient_member_id is null) = 0,
    'D1 a zero-amount discretionary buffer creates no external gift line';
end $$;

-- ── Scenario D2: a positive amount mints the external line ────────────────────
update public.gift_discretionary_budget set budgeted_amount_cents = 250_00
  where id = current_setting('s.discretionary')::uuid;
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where household_id = current_setting('s.hid')::uuid
      and is_gift_line and gift_recipient_member_id is null;
  assert r.name = 'Gifts', format('D2 external name, got %s', r.name);
  assert r.amount_cents = 250_00, format('D2 amount is the buffer alone, got %s', r.amount_cents);
  assert r.line_group = 'wants', 'D2 group seeded wants';
  assert r.destination_account_id is null, 'D2 unrouted by default';
  assert r.is_gift_line = true, 'D2 is_gift_line';
end $$;

-- ── Scenario D3: an external gift budget adds to the same partition total ─────
insert into public.gift_recipient (household_id, name)
  values (current_setting('s.hid')::uuid, 'Nan')
  returning id as s_rec_nan \gset
select set_config('s.rec_nan', :'s_rec_nan', false);
insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('s.hid')::uuid, current_setting('s.rec_nan')::uuid, current_setting('s.occ')::uuid, 40_00);
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where household_id = current_setting('s.hid')::uuid
      and is_gift_line and gift_recipient_member_id is null;
  assert r.amount_cents = 290_00, format('D3 buffer plus external budget, got %s', r.amount_cents);
end $$;

-- ── Scenario D4: zeroing the buffer alone leaves the line at the budget total ─
update public.gift_discretionary_budget set budgeted_amount_cents = 0
  where id = current_setting('s.discretionary')::uuid;
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where household_id = current_setting('s.hid')::uuid
      and is_gift_line and gift_recipient_member_id is null;
  assert r.amount_cents = 40_00,
    format('D4 buffer zeroed, external budget alone remains, got %s', r.amount_cents);
end $$;

-- ── Scenario D5: removing the last gift budget too, with the buffer still at
-- zero, removes the line entirely (empty and unrouted on both counts).
delete from public.gift_budget where recipient_id = current_setting('s.rec_nan')::uuid;
do $$ begin
  assert (select count(*) from public.budget_line
    where household_id = current_setting('s.hid')::uuid
      and is_gift_line and gift_recipient_member_id is null) = 0,
    'D5 empty and unrouted (budget gone, buffer zero) removes the external line';
end $$;

-- ── Scenario D6: deleting the buffer row outright is equivalent to zero ───────
update public.gift_discretionary_budget set budgeted_amount_cents = 100_00
  where id = current_setting('s.discretionary')::uuid;
do $$ begin
  assert (select count(*) from public.budget_line
    where household_id = current_setting('s.hid')::uuid
      and is_gift_line and gift_recipient_member_id is null) = 1,
    'D6 pre: buffer alone re-creates the line';
end $$;
delete from public.gift_discretionary_budget where id = current_setting('s.discretionary')::uuid;
do $$ begin
  assert (select count(*) from public.budget_line
    where household_id = current_setting('s.hid')::uuid
      and is_gift_line and gift_recipient_member_id is null) = 0,
    'D6 deleting the buffer row removes the external line (nothing left to keep it)';
end $$;

-- ── Scenario D7: idempotency — a fresh reconcile writes nothing after the
-- discretionary-buffer churn above either.
select md5(coalesce(string_agg(
    bl.id || '|' || bl.line_group || '|' || bl.name || '|' || bl.amount_cents || '|' ||
    bl.frequency || '|' || coalesce(bl.interval_count::text, '') || '|' ||
    coalesce(bl.goal_id::text, '') || '|' || coalesce(bl.breakdown_id::text, '') || '|' ||
    coalesce(bl.destination_account_id::text, '') || '|' ||
    coalesce(bl.gift_recipient_member_id::text, '') || '|' || bl.is_gift_line || '|' ||
    bl.updated_at, ',' order by bl.id), '')) as t_before
  from public.budget_line bl where bl.household_id = current_setting('s.hid')::uuid \gset
select set_config('d.before', :'t_before', false);

reset role;
select public.reconcile_derived_lines(current_setting('s.hid')::uuid);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000003","email":"cleo@example.com"}', true);

do $$
declare v_after text;
begin
  select md5(coalesce(string_agg(
      bl.id || '|' || bl.line_group || '|' || bl.name || '|' || bl.amount_cents || '|' ||
      bl.frequency || '|' || coalesce(bl.interval_count::text, '') || '|' ||
      coalesce(bl.goal_id::text, '') || '|' || coalesce(bl.breakdown_id::text, '') || '|' ||
      coalesce(bl.destination_account_id::text, '') || '|' ||
      coalesce(bl.gift_recipient_member_id::text, '') || '|' || bl.is_gift_line || '|' ||
      bl.updated_at, ',' order by bl.id), ''))
    into v_after
    from public.budget_line bl where bl.household_id = current_setting('s.hid')::uuid;
  assert v_after = current_setting('d.before'), 'D7 re-running reconcile after buffer churn changed nothing (no writes)';
end $$;

-- ══ Duo: member removal cascades a gift line and re-funds the survivor ════════
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000005","email":"eve@example.com"}', true);
select public.create_household('Duo', 'Eve') as u_hid \gset
select set_config('u.hid', :'u_hid', false);
select invite_code as u_code from public.create_invite_code() \gset
select set_config('u.code', :'u_code', false);
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000006","email":"finn@example.com"}', true);
select public.join_household(current_setting('u.code'), 'Finn');
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000005","email":"eve@example.com"}', true);
select id as u_mid_eve from public.members
  where household_id = current_setting('u.hid')::uuid and user_id = 'e0000000-0000-0000-0000-000000000005' \gset
select set_config('u.mid_eve', :'u_mid_eve', false);
select id as u_mid_finn from public.members
  where household_id = current_setting('u.hid')::uuid and user_id = 'f0000000-0000-0000-0000-000000000006' \gset
select set_config('u.mid_finn', :'u_mid_finn', false);

insert into public.accounts (household_id, owner_member_id, name, type)
  values (current_setting('u.hid')::uuid, current_setting('u.mid_eve')::uuid, 'Eve Spend', 'transaction')
  returning id as u_eve_spend \gset
select set_config('u.eve_spend', :'u_eve_spend', false);
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000006","email":"finn@example.com"}', true);
insert into public.accounts (household_id, owner_member_id, name, type)
  values (current_setting('u.hid')::uuid, current_setting('u.mid_finn')::uuid, 'Finn Spend', 'transaction')
  returning id as u_finn_spend \gset
select set_config('u.finn_spend', :'u_finn_spend', false);
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000005","email":"eve@example.com"}', true);
insert into public.gift_occasion (household_id, name)
  values (current_setting('u.hid')::uuid, 'Anniversary') returning id as u_occ \gset
select set_config('u.occ', :'u_occ', false);

-- A gift line per member, each funded by the other's account.
insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('u.hid')::uuid,
          (select id from public.gift_recipient where household_id = current_setting('u.hid')::uuid and member_id = current_setting('u.mid_eve')::uuid),
          current_setting('u.occ')::uuid, 100_00);
insert into public.gift_budget (household_id, recipient_id, occasion_id, budgeted_amount_cents)
  values (current_setting('u.hid')::uuid,
          (select id from public.gift_recipient where household_id = current_setting('u.hid')::uuid and member_id = current_setting('u.mid_finn')::uuid),
          current_setting('u.occ')::uuid, 200_00);
do $$
declare r public.budget_line;
begin
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('u.mid_eve')::uuid;
  assert r.destination_account_id = current_setting('u.finn_spend')::uuid, 'Duo pre: Eve''s gift funded by Finn';
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('u.mid_finn')::uuid;
  assert r.destination_account_id = current_setting('u.eve_spend')::uuid, 'Duo pre: Finn''s gift funded by Eve';
end $$;

-- ── Scenario 12: remove Finn. His gift line cascades away with his member link,
-- and Eve's line loses its buyer, so its funding falls to null.
reset role;
delete from public.members where id = current_setting('u.mid_finn')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000005","email":"eve@example.com"}', true);
do $$
declare r public.budget_line;
begin
  assert (select count(*) from public.budget_line
    where household_id = current_setting('u.hid')::uuid
      and is_gift_line and gift_recipient_member_id = current_setting('u.mid_finn')::uuid) = 0,
    'S12 removed member''s gift line cascades away';
  select * into r from public.budget_line
    where is_gift_line and gift_recipient_member_id = current_setting('u.mid_eve')::uuid;
  assert r.destination_account_id is null, 'S12 survivor gift line funding falls to null';
  assert r.amount_cents = 100_00, 'S12 survivor gift line amount unchanged';
end $$;

rollback;
