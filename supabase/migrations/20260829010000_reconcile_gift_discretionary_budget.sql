-- The ad hoc discretionary gift buffer folds into "Gifts (others)".
--
-- Per product decision, the buffer gets no derived line of its own: its planned
-- amount joins the external (null-member) gift partition's total, the same line
-- every external recipient's gift budgets already roll up into. This re-derives
-- reconcile_gift_total and reconcile_derived_lines (20260807000000) to read the
-- buffer, and installs a trigger on gift_discretionary_budget so an edit to it
-- re-derives the household's gift lines exactly as a gift_budget edit does.

-- ── reconcile_gift_total: the external partition also carries the buffer ─────

create or replace function public.reconcile_gift_total(p_household_id uuid, p_member_id uuid)
  returns bigint
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(sum(gb.budgeted_amount_cents), 0) + coalesce(
    case when p_member_id is null then (
      select gdb.budgeted_amount_cents
      from public.gift_discretionary_budget gdb
      where gdb.household_id = p_household_id
    ) end,
    0
  )
  from public.gift_budget gb
  join public.gift_recipient gr
    on gr.id = gb.recipient_id and gr.household_id = gb.household_id
  where gb.household_id = p_household_id
    and gr.member_id is not distinct from p_member_id;
$$;
comment on function public.reconcile_gift_total(uuid, uuid)
  is 'A gift partition''s budgeted total: the integer sum of budgeted cents for recipients linked to the member (null = external), plus — for the external partition only — the household''s discretionary gift buffer amount; zero when empty.';

-- ── reconcile_derived_lines: keep/create the external line for the buffer too ─

create or replace function public.reconcile_derived_lines(p_household_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_bd record;
  v_line record;
  v_item_count integer;
  v_fields record;
  v_key_rec record;
  v_ext_destination uuid;
  v_discretionary_amount bigint;
begin
  -- ── Generic breakdown lines ──
  for v_bd in
    select b.id, b.line_group, b.name
    from public.breakdown b
    where b.household_id = p_household_id
  loop
    select bl.* into v_line
    from public.budget_line bl
    where bl.breakdown_id = v_bd.id and bl.is_gift_line = false
    order by bl.created_at, bl.id
    limit 1;

    select count(*) into v_item_count
    from public.breakdown_item bi
    where bi.breakdown_id = v_bd.id;

    if v_line.id is null then
      -- No line yet: create one only when the breakdown has items.
      if v_item_count >= 1 then
        insert into public.budget_line
          (household_id, line_group, name, amount_cents, frequency, interval_count,
           goal_id, breakdown_id, destination_account_id, gift_recipient_member_id, is_gift_line)
        values
          (p_household_id, v_bd.line_group, v_bd.name, 0, 'annual', null,
           null, v_bd.id, null, null, false);
      end if;
    elsif v_item_count = 0 and v_line.destination_account_id is null then
      -- No items left and no routing to preserve: remove the line.
      delete from public.budget_line where id = v_line.id;
    else
      -- The line stays (items present, or itemless but routed at $0). Update only
      -- if it has drifted from its canonical fields.
      select * into v_fields from public.budget_line_derived_fields(
        p_household_id, v_bd.id, false, null,
        v_line.line_group, v_line.name, v_line.destination_account_id
      );
      if v_line.amount_cents is distinct from v_fields.o_amount
         or v_line.name is distinct from v_fields.o_name
         or v_line.line_group is distinct from v_fields.o_group
         or v_line.frequency is distinct from 'annual'
         or v_line.interval_count is distinct from null
         or v_line.gift_recipient_member_id is distinct from null
         or v_line.destination_account_id is distinct from v_fields.o_destination
      then
        update public.budget_line
        set line_group = v_fields.o_group,
            name = v_fields.o_name,
            amount_cents = v_fields.o_amount,
            frequency = 'annual',
            interval_count = null,
            gift_recipient_member_id = null,
            destination_account_id = v_fields.o_destination
        where id = v_line.id;
      end if;
    end if;
  end loop;

  -- ── Gift lines ──
  -- The kept external line's routing decides whether the emptied external line
  -- survives (at $0) or is removed; so does the discretionary buffer's amount.
  select bl.destination_account_id into v_ext_destination
  from public.budget_line bl
  where bl.household_id = p_household_id
    and bl.is_gift_line
    and bl.gift_recipient_member_id is null
  order by bl.created_at, bl.id
  limit 1;

  select gdb.budgeted_amount_cents into v_discretionary_amount
  from public.gift_discretionary_budget gdb
  where gdb.household_id = p_household_id;

  -- Reconcile every partition with budgets, plus the external partition when its
  -- line carries routing that must survive an empty partition, or the household
  -- has a discretionary buffer with a positive planned amount.
  for v_key_rec in
    select gr.member_id as key
    from public.gift_budget gb
    join public.gift_recipient gr
      on gr.id = gb.recipient_id and gr.household_id = gb.household_id
    where gb.household_id = p_household_id
    group by gr.member_id
    union
    select null::uuid where v_ext_destination is not null
    union
    select null::uuid where coalesce(v_discretionary_amount, 0) > 0
  loop
    select bl.* into v_line
    from public.budget_line bl
    where bl.household_id = p_household_id
      and bl.is_gift_line
      and bl.gift_recipient_member_id is not distinct from v_key_rec.key
    order by bl.created_at, bl.id
    limit 1;

    if v_line.id is null then
      -- Seed a new gift line; the normalizer fills name, amount, and routing.
      -- A brand-new gift line's group defaults to 'wants'.
      insert into public.budget_line
        (household_id, line_group, name, amount_cents, frequency, interval_count,
         goal_id, breakdown_id, destination_account_id, gift_recipient_member_id, is_gift_line)
      values
        (p_household_id, 'wants', 'Gifts', 0, 'annual', null,
         null, null, null, v_key_rec.key, true);
    else
      select * into v_fields from public.budget_line_derived_fields(
        p_household_id, null, true, v_key_rec.key,
        v_line.line_group, v_line.name, v_line.destination_account_id
      );
      if v_line.amount_cents is distinct from v_fields.o_amount
         or v_line.name is distinct from v_fields.o_name
         or v_line.line_group is distinct from v_fields.o_group
         or v_line.frequency is distinct from 'annual'
         or v_line.interval_count is distinct from null
         or (v_line.gift_recipient_member_id is distinct from v_key_rec.key)
         or v_line.destination_account_id is distinct from v_fields.o_destination
      then
        update public.budget_line
        set line_group = v_fields.o_group,
            name = v_fields.o_name,
            amount_cents = v_fields.o_amount,
            frequency = 'annual',
            interval_count = null,
            gift_recipient_member_id = v_key_rec.key,
            destination_account_id = v_fields.o_destination
        where id = v_line.id;
      end if;
    end if;
  end loop;

  -- Remove a member line once its partition has no budgets, and the external line
  -- once it is empty, unrouted, and the discretionary buffer is zero or absent.
  for v_line in
    select bl.*
    from public.budget_line bl
    where bl.household_id = p_household_id and bl.is_gift_line
  loop
    if exists (
      select 1
      from public.gift_budget gb
      join public.gift_recipient gr
        on gr.id = gb.recipient_id and gr.household_id = gb.household_id
      where gb.household_id = p_household_id
        and gr.member_id is not distinct from v_line.gift_recipient_member_id
    ) then
      continue;
    end if;
    if v_line.gift_recipient_member_id is null and v_line.destination_account_id is not null then
      continue;
    end if;
    if v_line.gift_recipient_member_id is null and coalesce(v_discretionary_amount, 0) > 0 then
      continue;
    end if;
    delete from public.budget_line where id = v_line.id;
  end loop;
end;
$$;
comment on function public.reconcile_derived_lines(uuid)
  is 'Brings one household''s derived budget lines (generic and gift) into line with their sources, writing only what changed; mirrors the client reconciler and is idempotent. The external gift partition also survives on the household''s discretionary gift buffer alone, at a positive amount.';

-- ── gift_discretionary_budget: re-derive the external line on every change ────

create function public.reconcile_on_gift_discretionary_budget()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.reconcile_derived_lines(old.household_id);
    return old;
  end if;
  perform public.reconcile_derived_lines(new.household_id);
  return new;
end;
$$;
comment on function public.reconcile_on_gift_discretionary_budget()
  is 'Re-derives the external ("Gifts (others)") gift line when the household''s discretionary gift buffer amount changes or the buffer row is removed.';

create trigger reconcile_derived_lines
  after insert or delete or update of budgeted_amount_cents
  on public.gift_discretionary_budget
  for each row execute function public.reconcile_on_gift_discretionary_budget();

-- ── One-time backfill ────────────────────────────────────────────────────────
--
-- Converge every existing household's derived lines to the updated engine, so a
-- household with an existing (pre-feature) discretionary buffer — none can exist
-- yet, but a household whose external partition drifted for any other reason —
-- settles immediately.
do $$
declare
  v_household_id uuid;
begin
  for v_household_id in select id from public.households loop
    perform public.reconcile_derived_lines(v_household_id);
  end loop;
end;
$$;
