-- `create_deduction_with_receipts` carries a deduction's category.
--
-- The same gap as the migrations before this one: the add form writes every
-- new deduction through this function, the function names its columns
-- explicitly, and `category` was added to `deduction` after it was written.
-- Left unnamed, a donation or tax agent fee entered on the add form would
-- silently write as `work_expense` — the column's own default rather than what
-- the member picked. Defaulted to `work_expense` here too, matching the
-- column's own default, so a payload naming no category still succeeds.

create or replace function public.create_deduction_with_receipts(p_deduction jsonb, p_receipts jsonb)
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
    basis, distance_km, group_id, full_amount_cents, work_use_percent, category
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
    group_id = excluded.group_id,
    full_amount_cents = excluded.full_amount_cents,
    work_use_percent = excluded.work_use_percent,
    category = excluded.category;

  -- The receipts are always saved as the whole set already uploaded when the
  -- member saves, so the stored set is replaced rather than reconciled.
  delete from public.deduction_receipt where deduction_id = v_id;

  insert into public.deduction_receipt (household_id, deduction_id, storage_path, file_name)
  select
    v_household_id,
    v_id,
    receipt ->> 'storage_path',
    receipt ->> 'file_name'
  from jsonb_array_elements(coalesce(p_receipts, '[]'::jsonb)) as receipt;

  return v_id;
end;
$$;

comment on function public.create_deduction_with_receipts(jsonb, jsonb) is 'Writes one deduction and its already-uploaded receipts in a single transaction, keyed on the caller-minted id so a retried save rewrites the deduction instead of duplicating it. Carries the deduction''s entry basis, the kilometres behind a distance-basis claim, the group it is filed under, its work-use apportioning, and its category. Runs as the caller, so household RLS gates every statement.';
