-- A deduction created from a ledger transaction.
--
-- `deduction.transaction_id` points at the outflow a member turned into a
-- deduction, so deductible spending reaches the tax estimate without re-keying
-- it. The reference is household-scoped like every other composite foreign key,
-- and nullable: a hand-entered deduction has no source. One transaction backs at
-- most one deduction. Deleting the transaction (a sync that drops it) clears the
-- link and leaves the deduction in place; deleting the deduction frees the
-- transaction to back another.

alter table public.deduction
  add column transaction_id uuid,
  add constraint deduction_transaction_id_household_id_fkey
    foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete set null (transaction_id);

comment on column public.deduction.transaction_id is 'The ledger transaction this deduction was created from; null for a hand-entered deduction or once the transaction is deleted.';

-- The index's leading column also serves lookups by transaction and the
-- composite foreign key's own checks.
create unique index deduction_transaction_id_key
  on public.deduction (transaction_id)
  where transaction_id is not null;

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
    basis, distance_km, work_from_home_hours, group_id, full_amount_cents, work_use_percent, category,
    transaction_id
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
    coalesce((p_deduction ->> 'category')::public.deduction_category, 'work_expense'),
    nullif(p_deduction ->> 'transaction_id', '')::uuid
  )
  -- household_id is deliberately not updatable: it is the RLS boundary, and a
  -- deduction does not move households. A conflict on an id outside the
  -- caller's own household fails the update policy rather than being rewritten.
  -- transaction_id is not rewritten either: the link is fixed at creation.
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

comment on function public.create_deduction_with_receipt(jsonb, text) is 'Writes one deduction and its already-uploaded receipt (if any) in a single transaction, keyed on the caller-minted id so a retried save rewrites the deduction instead of duplicating it. Carries the deduction''s entry basis, the kilometres behind a distance-basis claim, the hours behind a work-from-home claim, the group it is filed under, its work-use apportioning, its category, and the transaction it was created from. Runs as the caller, so household RLS gates every statement.';

revoke execute on function public.create_deduction_with_receipt(jsonb, text) from public;
grant execute on function public.create_deduction_with_receipt(jsonb, text) to authenticated;
