-- Working from home, claimed under the ATO's fixed rate method.
--
-- The fixed rate method prices each hour worked from home at the financial
-- year's published cents-per-hour rate (`@nest/tax`'s `workFromHome` config,
-- via `workFromHomeDeductionCents`), so the natural entry is the hours worked,
-- not a dollar figure. A deduction on the `hours` basis states
-- `work_from_home_hours`, and the form converts it to `amount_cents` at save
-- time — the same snapshot-at-write-time pattern the `distance` basis follows,
-- so a later change to the ATO rate cannot retroactively move a deduction
-- already claimed. `amount_cents` stays the single figure every reader uses.
--
-- Like `distance`, the basis is a work-expense concern alone, pins
-- `work_use_percent` at 100 (the hours are work hours already), and is fixed
-- once the deduction exists (`deduction_basis_immutable` fires on any basis
-- change, so it already covers it).

alter table public.deduction
  add column if not exists work_from_home_hours numeric(8, 2);

comment on column public.deduction.work_from_home_hours is 'Hours worked from home, for a deduction claimed under the ATO''s fixed rate method; null unless basis = ''hours''. amount_cents is still the stored, authoritative deduction amount — this is the figure of hours it was computed from.';

alter table public.deduction drop constraint if exists deduction_basis_attribution;
alter table public.deduction add constraint deduction_basis_attribution check (
  case basis
    when 'distance' then distance_km is not null and distance_km >= 0 and work_from_home_hours is null
    when 'hours' then work_from_home_hours is not null and work_from_home_hours >= 0 and distance_km is null
    when 'amount' then distance_km is null and work_from_home_hours is null
    else true
  end
);

alter table public.deduction drop constraint if exists deduction_hours_basis_work_expense;
alter table public.deduction add constraint deduction_hours_basis_work_expense check (
  basis <> 'hours' or category = 'work_expense'
);

alter table public.deduction drop constraint if exists deduction_work_use_basis;
alter table public.deduction add constraint deduction_work_use_basis check (
  (basis = 'amount' and category = 'work_expense') or work_use_percent = 100
);

create or replace function public.create_deduction_with_receipt(p_deduction jsonb, p_receipt_path text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := coalesce(nullif(p_deduction ->> 'id', '')::uuid, gen_random_uuid());
  v_household_id uuid := (p_deduction ->> 'household_id')::uuid;
begin
  insert into public.deduction (
    id, household_id, member_id, description, amount_cents, deduction_date, financial_year,
    basis, distance_km, work_from_home_hours, group_id, full_amount_cents, work_use_percent, category
  )
  values (
    v_id,
    v_household_id,
    (p_deduction ->> 'member_id')::uuid,
    p_deduction ->> 'description',
    (p_deduction ->> 'amount_cents')::bigint,
    (p_deduction ->> 'deduction_date')::date,
    (p_deduction ->> 'financial_year')::integer,
    coalesce((p_deduction ->> 'basis')::public.deduction_basis, 'amount'),
    (p_deduction ->> 'distance_km')::numeric,
    (p_deduction ->> 'work_from_home_hours')::numeric,
    nullif(p_deduction ->> 'group_id', '')::uuid,
    -- Left null when the payload omits it: snapshot_deduction_full_amount (the
    -- BEFORE INSERT trigger) fills it from amount_cents before the NOT NULL
    -- constraint is checked, exactly as a direct insert with no work-use figures
    -- is filled.
    (p_deduction ->> 'full_amount_cents')::bigint,
    coalesce((p_deduction ->> 'work_use_percent')::numeric, 100),
    coalesce((p_deduction ->> 'category')::public.deduction_category, 'work_expense')
  )
  -- household_id is deliberately not updatable: it is the RLS boundary, and a
  -- deduction does not move households. A conflict on an id outside the
  -- caller's own household fails the update policy rather than being rewritten.
  on conflict (id) do update set
    member_id = excluded.member_id,
    description = excluded.description,
    amount_cents = excluded.amount_cents,
    deduction_date = excluded.deduction_date,
    financial_year = excluded.financial_year,
    basis = excluded.basis,
    distance_km = excluded.distance_km,
    work_from_home_hours = excluded.work_from_home_hours,
    group_id = excluded.group_id,
    full_amount_cents = excluded.full_amount_cents,
    work_use_percent = excluded.work_use_percent,
    category = excluded.category;

  -- The receipt is always saved as the one already uploaded when the member
  -- saves, so a retried save replaces the stored one rather than reconciling.
  delete from public.deduction_receipt where deduction_id = v_id;

  if p_receipt_path is not null then
    insert into public.deduction_receipt (household_id, deduction_id, storage_path)
    values (v_household_id, v_id, p_receipt_path);
  end if;

  return v_id;
end;
$$;

comment on function public.create_deduction_with_receipt(jsonb, text) is 'Writes one deduction and its already-uploaded receipt (if any) in a single transaction, keyed on the caller-minted id so a retried save rewrites the deduction instead of duplicating it. Carries the deduction''s entry basis, the kilometres behind a distance-basis claim, the hours behind a work-from-home claim, the group it is filed under, its work-use apportioning, and its category. Runs as the caller, so household RLS gates every statement.';

revoke execute on function public.create_deduction_with_receipt(jsonb, text) from public;
grant execute on function public.create_deduction_with_receipt(jsonb, text) to authenticated;
