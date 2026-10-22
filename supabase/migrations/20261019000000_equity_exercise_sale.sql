-- Equity option exercises and sales: what a member has done with a grant.
--
-- An `equity_exercise` converts options into shares at the grant's strike; an
-- `equity_sale` sells shares for cash. Both hang off an `equity_grant`, so the
-- grant's vesting schedule stays the source of what is exercisable. Held units
-- and capital gains are derived from these rows in `@nest/plan` and `@nest/tax`,
-- never stored. Money is integer cents in bigint columns; quantities are whole
-- units. RLS on household membership is the isolation boundary, and composite
-- foreign keys keep each reference inside the household.

-- ── Grants must be addressable by (id, household_id) for the composite keys ───

alter table public.equity_grant
  add constraint equity_grant_id_household_id_key unique (id, household_id);

create table public.equity_exercise (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  grant_id uuid not null,
  exercised_on date not null,
  quantity bigint not null check (quantity > 0),
  strike_price_cents bigint not null check (strike_price_cents >= 0),
  market_price_per_share_cents bigint check (market_price_per_share_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  foreign key (grant_id, household_id)
    references public.equity_grant (id, household_id) on delete cascade
);
create index on public.equity_exercise (household_id);
create index on public.equity_exercise (member_id, household_id);
create index on public.equity_exercise (grant_id, household_id);
comment on table public.equity_exercise is 'A member''s exercise of options from an equity grant, converting them to shares at the strike; no tax arises at exercise under the startup concession.';
comment on column public.equity_exercise.grant_id is 'The option grant exercised; only an option grant takes exercises.';
comment on column public.equity_exercise.exercised_on is 'The date the options were exercised.';
comment on column public.equity_exercise.quantity is 'Whole options exercised; always positive.';
comment on column public.equity_exercise.strike_price_cents is 'Per-share exercise price paid, in integer cents, snapshotted from the grant when the exercise is written so a later strike edit cannot move a recorded exercise.';
comment on column public.equity_exercise.market_price_per_share_cents is 'Informational market value per share at exercise, in integer cents; null when not recorded. Feeds no calculation.';

create table public.equity_sale (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  grant_id uuid not null,
  sold_on date not null,
  quantity bigint not null check (quantity > 0),
  price_per_share_cents bigint not null check (price_per_share_cents >= 0),
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  foreign key (grant_id, household_id)
    references public.equity_grant (id, household_id) on delete cascade
);
create index on public.equity_sale (household_id);
create index on public.equity_sale (member_id, household_id);
create index on public.equity_sale (grant_id, household_id);
comment on table public.equity_sale is 'A member''s sale of shares from an equity grant (exercised options, or shares granted outright); each sale is a capital-gains event.';
comment on column public.equity_sale.grant_id is 'The grant the sold shares came from.';
comment on column public.equity_sale.sold_on is 'The sale date; the CGT discount holding period runs from the grant date to this date.';
comment on column public.equity_sale.quantity is 'Whole shares sold; always positive.';
comment on column public.equity_sale.price_per_share_cents is 'Sale price per share in integer cents, excluding fees; never negative.';
comment on column public.equity_sale.fee_cents is 'Fees in integer cents, deducted from the sale''s proceeds.';

-- ── Snapshot the strike when an exercise is written ──────────────────────────

create function public.snapshot_equity_exercise_strike()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.strike_price_cents is null then
    select coalesce(g.strike_price_cents, 0) into new.strike_price_cents
    from public.equity_grant g
    where g.id = new.grant_id and g.household_id = new.household_id;
  end if;
  return new;
end;
$$;

create trigger snapshot_strike before insert on public.equity_exercise
  for each row execute function public.snapshot_equity_exercise_strike();

-- ── Quantity guards ────────────────────────────────────────────────────────────
-- Only an option grant takes exercises; exercised units cannot exceed the grant,
-- and sold units cannot exceed what is held (exercised units for an option grant,
-- the grant's quantity for a share grant). The messages are fixed and carry no
-- amounts. The check runs after every change to a grant, exercise, or sale, so
-- deleting an exercise or shrinking a grant cannot strand a sale either.

create function public.check_equity_quantities()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_instrument public.equity_instrument_type;
  v_quantity bigint;
  v_exercised bigint;
  v_sold bigint;
begin
  -- An equity_grant row names itself; an exercise or sale names its grant. An
  -- update that moves a row to another grant checks the grant it left too.
  v_ids := array[coalesce(
    (to_jsonb(case when tg_op = 'DELETE' then old else new end) ->> 'grant_id')::uuid,
    case when tg_op = 'DELETE' then old.id else new.id end
  )];
  if tg_op = 'UPDATE' and tg_table_name <> 'equity_grant' then
    v_ids := v_ids || (to_jsonb(old) ->> 'grant_id')::uuid;
  end if;

  foreach v_id in array v_ids loop
    select instrument_type, quantity into v_instrument, v_quantity
    from public.equity_grant where id = v_id;
    if not found then
      continue;
    end if;
    select coalesce(sum(quantity), 0) into v_exercised
    from public.equity_exercise where grant_id = v_id;
    select coalesce(sum(quantity), 0) into v_sold
    from public.equity_sale where grant_id = v_id;

    if v_exercised > 0 and v_instrument <> 'option' then
      raise exception 'equity_exercise_not_option' using errcode = 'check_violation';
    end if;
    if v_exercised > v_quantity then
      raise exception 'equity_exercise_exceeds_grant' using errcode = 'check_violation';
    end if;
    if v_sold > (case when v_instrument = 'option' then v_exercised else v_quantity end) then
      raise exception 'equity_sale_exceeds_holding' using errcode = 'check_violation';
    end if;
  end loop;
  return null;
end;
$$;

create trigger check_quantities after insert or update or delete on public.equity_exercise
  for each row execute function public.check_equity_quantities();
create trigger check_quantities after insert or update or delete on public.equity_sale
  for each row execute function public.check_equity_quantities();
create trigger check_quantities after update of quantity, instrument_type on public.equity_grant
  for each row execute function public.check_equity_quantities();

-- ── updated_at triggers ────────────────────────────────────────────────────────

create trigger set_updated_at before update on public.equity_exercise
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.equity_sale
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.equity_exercise enable row level security;
alter table public.equity_sale enable row level security;

create policy "household members manage equity exercises" on public.equity_exercise
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage equity sales" on public.equity_sale
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.equity_exercise to authenticated;
grant select, insert, update, delete on public.equity_sale to authenticated;

-- The EOFY share view (eofy-share) reads a household's grants, exercises, and
-- sales on a service-role client to estimate the shared year's net capital gain;
-- service_role bypasses RLS but still needs the table-level grants. Read-only.
grant select on public.equity_grant to service_role;
grant select on public.equity_exercise to service_role;
grant select on public.equity_sale to service_role;
