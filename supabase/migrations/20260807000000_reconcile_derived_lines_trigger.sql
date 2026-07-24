-- Maintain derived budget lines with database triggers.
--
-- A household's derived budget lines — the generic breakdown lines and the gift
-- lines — are rolled up from their sources (breakdown items and gift budgets)
-- rather than typed. This installs the roll-up as Postgres triggers, so the
-- derived lines stay in step the moment any source changes, computed once in the
-- database rather than by each client.
--
-- The logic mirrors the client reconciler exactly (apps/pwa/src/lib/breakdowns.ts,
-- gifts.ts, and packages/plan/src/normalize.ts): a source change re-derives the
-- whole household's derived lines, producing the identical budget_line tuple the
-- client would. The client reconciler stays running as a convergent safety net;
-- it and these triggers must always agree, so every field is derived the same way.
--
-- Two layers:
--   • public.reconcile_derived_lines(household) — the engine: brings a
--     household's derived lines into being, up to date, or away. Source triggers
--     on breakdown_item / breakdown / gift_budget / gift_recipient / members /
--     accounts call it after any relevant change.
--   • a budget_line BEFORE INSERT/UPDATE normalizer — canonicalises any derived
--     row written by anyone (a user, the client, or the engine itself): stamps
--     frequency = 'annual' / interval_count = null and recomputes amount, name,
--     and routing from the roll-up. One place computes the derived fields, shared
--     by the engine's drift check and by every direct write.
--
-- All functions are SECURITY DEFINER with an empty search_path and fully
-- schema-qualified, scoped by household_id, modelled on the existing
-- add_member_gift_recipient / household_ids_for_current_user triggers.

-- ── Roll-up helpers ──────────────────────────────────────────────────────────

-- Annualise one amount to whole cents, matching packages/plan/src/normalize.ts
-- annualCents. Fixed frequencies multiply by their exact periods per year; the
-- every_n_* cadences round with floor(x + 0.5) (JavaScript Math.round) over a
-- numeric divide, so no integer truncation. An absent or non-positive interval
-- annualises to zero, as the client does.
create function public.reconcile_annual_cents(
  p_amount bigint,
  p_frequency public.frequency,
  p_interval_count integer
) returns bigint
  language plpgsql
  immutable
  set search_path = ''
as $$
begin
  if p_frequency = 'every_n_weeks' then
    if p_interval_count is null or p_interval_count < 1 then
      return 0;
    end if;
    return floor(p_amount::numeric * 52 / p_interval_count + 0.5)::bigint;
  elsif p_frequency = 'every_n_months' then
    if p_interval_count is null or p_interval_count < 1 then
      return 0;
    end if;
    return floor(p_amount::numeric * 12 / p_interval_count + 0.5)::bigint;
  elsif p_frequency = 'weekly' then
    return p_amount * 52;
  elsif p_frequency = 'fortnightly' then
    return p_amount * 26;
  elsif p_frequency = 'monthly' then
    return p_amount * 12;
  elsif p_frequency = 'quarterly' then
    return p_amount * 4;
  elsif p_frequency = 'biannual' then
    return p_amount * 2;
  elsif p_frequency = 'annual' then
    return p_amount;
  else
    return 0;
  end if;
end;
$$;
comment on function public.reconcile_annual_cents(bigint, public.frequency, integer)
  is 'Annualises one amount to whole cents (mirrors normalize.ts annualCents): fixed frequencies multiply exactly, every_n_* round floor(x+0.5) over a numeric divide.';

-- A generic breakdown's rolled-up annual total: each item annualised (rounded)
-- then summed, coalescing an itemless breakdown to zero.
create function public.reconcile_generic_total(p_breakdown_id uuid)
  returns bigint
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    sum(public.reconcile_annual_cents(bi.amount_cents, bi.frequency, bi.interval_count)),
    0
  )
  from public.breakdown_item bi
  where bi.breakdown_id = p_breakdown_id;
$$;
comment on function public.reconcile_generic_total(uuid)
  is 'A generic breakdown''s annual roll-up: each item annualised (rounded) then summed; zero when itemless.';

-- A gift partition's planned spend: the plain integer sum of budgeted cents for
-- every gift budget whose recipient links to the given member (null = the
-- external, non-member partition), coalescing an empty partition to zero.
create function public.reconcile_gift_total(p_household_id uuid, p_member_id uuid)
  returns bigint
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(sum(gb.budgeted_amount_cents), 0)
  from public.gift_budget gb
  join public.gift_recipient gr
    on gr.id = gb.recipient_id and gr.household_id = gb.household_id
  where gb.household_id = p_household_id
    and gr.member_id is not distinct from p_member_id;
$$;
comment on function public.reconcile_gift_total(uuid, uuid)
  is 'A gift partition''s budgeted total: the integer sum of budgeted cents for recipients linked to the member (null = external), zero when empty.';

-- The spending account that funds a member's gift line: the buyer's — the other
-- household member's — own transaction account (mirrors gifts.ts
-- buyerSpendingAccountId). The owner filter excludes the joint account (owner
-- null); the order by name, id tiebreak keeps the choice deterministic. Null when
-- there is no other member or no such account.
create function public.reconcile_buyer_account(p_household_id uuid, p_recipient_member_id uuid)
  returns uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select a.id
  from public.accounts a
  where a.household_id = p_household_id
    and a.type = 'transaction'
    and a.owner_member_id is not null
    and a.owner_member_id <> p_recipient_member_id
    and a.owner_member_id in (
      select m.id from public.members m where m.household_id = p_household_id
    )
  order by a.name, a.id
  limit 1;
$$;
comment on function public.reconcile_buyer_account(uuid, uuid)
  is 'The buyer''s (the other member''s) transaction account that funds a member gift line; null when there is no other member or matching account.';

-- ── Canonical derived fields ─────────────────────────────────────────────────

-- The canonical roll-up-driven fields for one derived line, given its
-- discriminators and its current group/name/routing (which some fields preserve).
-- The single place that computes what a derived line should hold: used by the
-- normalizer to stamp every write and by the engine's drift check. Mirrors
-- breakdowns.ts derivedInput / giftLineName / giftPartitionDestination /
-- preservedDestination and reconcileGenericBreakdown's group rule.
create function public.budget_line_derived_fields(
  p_household_id uuid,
  p_breakdown_id uuid,
  p_is_gift_line boolean,
  p_gift_recipient_member_id uuid,
  p_current_group public.budget_group,
  p_current_name text,
  p_current_destination uuid,
  out o_group public.budget_group,
  out o_name text,
  out o_amount bigint,
  out o_destination uuid
)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_member_name text;
begin
  if p_is_gift_line then
    -- A gift line keeps its own group (the engine seeds 'wants' on create); the
    -- roll-up never overwrites it.
    o_group := p_current_group;
    o_amount := public.reconcile_gift_total(p_household_id, p_gift_recipient_member_id);
    if p_gift_recipient_member_id is null then
      -- The external ("others") partition: a stable name and the line's own
      -- user-set routing, cleared under a goal-routed group.
      o_name := 'Gifts';
      o_destination := case
        when o_group in ('savings', 'investments') then null
        else p_current_destination
      end;
    else
      -- A member partition: "Gifts for <member>" (a 3-way fallback avoids an
      -- empty name if the member is somehow unresolved), funded automatically
      -- from the buyer's account, cleared under a goal-routed group.
      select m.name into v_member_name
      from public.members m
      where m.id = p_gift_recipient_member_id and m.household_id = p_household_id;
      if v_member_name is not null then
        o_name := 'Gifts for ' || v_member_name;
      else
        o_name := coalesce(p_current_name, 'Gifts');
      end if;
      o_destination := case
        when o_group in ('savings', 'investments') then null
        else public.reconcile_buyer_account(p_household_id, p_gift_recipient_member_id)
      end;
    end if;
  else
    -- A generic breakdown line tracks its breakdown's group and name, its item
    -- roll-up, and its own user-set routing (cleared under a goal-routed group).
    select b.line_group, b.name into o_group, o_name
    from public.breakdown b
    where b.id = p_breakdown_id;
    o_amount := public.reconcile_generic_total(p_breakdown_id);
    o_destination := case
      when o_group in ('savings', 'investments') then null
      else p_current_destination
    end;
  end if;
  return;
end;
$$;
comment on function public.budget_line_derived_fields(uuid, uuid, boolean, uuid, public.budget_group, text, uuid)
  is 'The canonical roll-up fields (group, name, amount, routing) for one derived line; shared by the budget_line normalizer and the reconcile engine so both agree.';

-- ── budget_line normalizer ───────────────────────────────────────────────────

-- Canonicalises every derived budget_line row on write: forces
-- frequency = 'annual' / interval_count = null and recomputes group, name,
-- amount, and routing from the roll-up. A plain manual line passes through
-- untouched. This makes any direct write — a user edit, the client reconciler, or
-- the engine below — land the same canonical tuple, so the surfaces never drift.
create function public.budget_line_normalize_derived()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_fields record;
begin
  if new.is_gift_line or new.breakdown_id is not null then
    select * into v_fields from public.budget_line_derived_fields(
      new.household_id,
      new.breakdown_id,
      new.is_gift_line,
      new.gift_recipient_member_id,
      new.line_group,
      new.name,
      new.destination_account_id
    );
    new.line_group := v_fields.o_group;
    new.name := v_fields.o_name;
    new.amount_cents := v_fields.o_amount;
    new.destination_account_id := v_fields.o_destination;
    new.frequency := 'annual';
    new.interval_count := null;
  end if;
  return new;
end;
$$;
comment on function public.budget_line_normalize_derived()
  is 'BEFORE INSERT/UPDATE on budget_line: canonicalises a derived row (frequency, interval, amount, name, group, routing) from the roll-up; manual lines pass through.';

create trigger budget_line_normalize_derived
  before insert or update on public.budget_line
  for each row execute function public.budget_line_normalize_derived();

-- ── Reconcile engine ─────────────────────────────────────────────────────────

-- Brings one household's derived lines into line with its sources: generic
-- breakdown lines against their item roll-ups, and gift lines against the gift
-- budgets, exactly as the client reconciler does over the whole household. Writes
-- only what has changed — a create for a missing line, an update for a drifted
-- one, a delete for one that should no longer exist — so a converged household
-- takes no further writes (the normalizer computes the stored values on each
-- write). Idempotent by construction.
create function public.reconcile_derived_lines(p_household_id uuid)
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
  -- survives (at $0) or is removed.
  select bl.destination_account_id into v_ext_destination
  from public.budget_line bl
  where bl.household_id = p_household_id
    and bl.is_gift_line
    and bl.gift_recipient_member_id is null
  order by bl.created_at, bl.id
  limit 1;

  -- Reconcile every partition with budgets, plus the external partition when its
  -- line carries routing that must survive an empty partition.
  for v_key_rec in
    select gr.member_id as key
    from public.gift_budget gb
    join public.gift_recipient gr
      on gr.id = gb.recipient_id and gr.household_id = gb.household_id
    where gb.household_id = p_household_id
    group by gr.member_id
    union
    select null::uuid where v_ext_destination is not null
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
  -- once it is both empty and unrouted.
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
    delete from public.budget_line where id = v_line.id;
  end loop;
end;
$$;
comment on function public.reconcile_derived_lines(uuid)
  is 'Brings one household''s derived budget lines (generic and gift) into line with their sources, writing only what changed; mirrors the client reconciler and is idempotent.';

-- The engine and its helpers act on a household passed in; they must not be
-- callable directly by clients (that could write another household's lines). The
-- triggers below invoke them as the definer regardless.
revoke execute on function public.reconcile_annual_cents(bigint, public.frequency, integer) from public;
revoke execute on function public.reconcile_generic_total(uuid) from public;
revoke execute on function public.reconcile_gift_total(uuid, uuid) from public;
revoke execute on function public.reconcile_buyer_account(uuid, uuid) from public;
revoke execute on function public.budget_line_derived_fields(uuid, uuid, boolean, uuid, public.budget_group, text, uuid) from public;
revoke execute on function public.reconcile_derived_lines(uuid) from public;

-- ── Source triggers ──────────────────────────────────────────────────────────
--
-- Each fires reconcile for the affected household after a change to a roll-up
-- source. Statement-level scoping (column lists) keeps them quiet on unrelated
-- edits; the engine itself no-ops when nothing drifted.

-- breakdown_item: a generic breakdown's items drive its line's amount and
-- existence. An item moved between breakdowns re-derives both.
create function public.reconcile_on_breakdown_item()
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
  if tg_op = 'UPDATE' and old.household_id is distinct from new.household_id then
    perform public.reconcile_derived_lines(old.household_id);
  end if;
  return new;
end;
$$;
comment on function public.reconcile_on_breakdown_item()
  is 'Re-derives a breakdown''s line when its items change (both breakdowns on a cross-breakdown move).';

create trigger reconcile_derived_lines
  after insert or delete or update of amount_cents, frequency, interval_count, breakdown_id
  on public.breakdown_item
  for each row execute function public.reconcile_on_breakdown_item();

-- breakdown: its name and group flow to its derived line.
create function public.reconcile_on_breakdown()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform public.reconcile_derived_lines(new.household_id);
  return new;
end;
$$;
comment on function public.reconcile_on_breakdown()
  is 'Re-derives a breakdown''s line when its name or group changes.';

create trigger reconcile_derived_lines
  after update of name, line_group
  on public.breakdown
  for each row execute function public.reconcile_on_breakdown();

-- gift_budget: the budgeted amounts drive each partition's line. A budget moved
-- to another recipient re-derives both partitions.
create function public.reconcile_on_gift_budget()
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
comment on function public.reconcile_on_gift_budget()
  is 'Re-derives the gift lines when a gift budget''s amount or recipient changes.';

create trigger reconcile_derived_lines
  after insert or delete or update of budgeted_amount_cents, recipient_id
  on public.gift_budget
  for each row execute function public.reconcile_on_gift_budget();

-- gift_recipient: a recipient's member link partitions the gift budgets. A
-- relink or removal re-derives every gift line for the household.
create function public.reconcile_on_gift_recipient()
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
comment on function public.reconcile_on_gift_recipient()
  is 'Re-derives the household''s gift lines when a recipient''s member link changes or the recipient is removed.';

create trigger reconcile_derived_lines
  after delete or update of member_id
  on public.gift_recipient
  for each row execute function public.reconcile_on_gift_recipient();

-- members: a member's presence and name drive the gift member lines (existence,
-- name, and — as the buyer of the other member's gifts — funding).
create function public.reconcile_on_member()
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
comment on function public.reconcile_on_member()
  is 'Re-derives the household''s gift lines when a member is added, renamed, or removed.';

create trigger reconcile_derived_lines
  after insert or delete or update of name
  on public.members
  for each row execute function public.reconcile_on_member();

-- accounts: a member's transaction account funds the other member's gift line, so
-- its arrival, retitling, retyping, or reassignment re-derives the gift lines.
create function public.reconcile_on_account()
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
comment on function public.reconcile_on_account()
  is 'Re-derives the household''s gift member lines'' funding when a transaction account changes.';

create trigger reconcile_derived_lines
  after insert or delete or update of owner_member_id, type, name
  on public.accounts
  for each row execute function public.reconcile_on_account();

-- ── One-time backfill ────────────────────────────────────────────────────────
--
-- Converge every existing household's derived lines to the trigger output, so
-- live data matches the engine immediately (and agrees with the still-running
-- client reconciler).
do $$
declare
  v_household_id uuid;
begin
  for v_household_id in select id from public.households loop
    perform public.reconcile_derived_lines(v_household_id);
  end loop;
end;
$$;
