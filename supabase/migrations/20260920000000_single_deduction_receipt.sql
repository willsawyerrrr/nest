-- A deduction carries at most one receipt, held in the database rather than
-- left to the UI.
--
-- Existing data: a deduction that already holds several receipts keeps its
-- earliest (by `created_at`, then `id`) and loses the surplus rows. The
-- surplus Storage objects are deliberately left in the private `receipts`
-- bucket, unreferenced but not deleted, so no evidence is destroyed by the
-- migration; a count of the dropped rows is raised as a notice. Storage objects
-- cannot be removed from SQL without orphaning their blobs, so cleanup is
-- manual if ever wanted.
--
-- `file_name` is dropped: the receipt is always shown as "Receipt", and the
-- object's own key and Storage metadata carry its type.
--
-- Idempotent, so a retried migration lands.

do $$
declare
  v_dropped integer;
begin
  with ranked as (
    select id, row_number() over (partition by deduction_id order by created_at, id) as position
    from public.deduction_receipt
  ),
  surplus as (
    delete from public.deduction_receipt r
    using ranked
    where r.id = ranked.id and ranked.position > 1
    returning r.id
  )
  select count(*) into v_dropped from surplus;

  if v_dropped > 0 then
    raise notice 'dropped % surplus deduction_receipt rows (Storage objects kept)', v_dropped;
  end if;
end $$;

alter table public.deduction_receipt drop column if exists file_name;

drop index if exists public.deduction_receipt_deduction_id_idx;
alter table public.deduction_receipt drop constraint if exists deduction_receipt_deduction_id_key;
alter table public.deduction_receipt add constraint deduction_receipt_deduction_id_key unique (deduction_id);

comment on table public.deduction_receipt is 'The stored receipt file backing a deduction, at most one per deduction; the file lives in the private `receipts` Storage bucket and this row records its path.';

drop function if exists public.create_deduction_with_receipts(jsonb, jsonb);

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

comment on function public.create_deduction_with_receipt(jsonb, text) is 'Writes one deduction and its already-uploaded receipt (if any) in a single transaction, keyed on the caller-minted id so a retried save rewrites the deduction instead of duplicating it. Carries the deduction''s entry basis, the kilometres behind a distance-basis claim, the group it is filed under, its work-use apportioning, and its category. Runs as the caller, so household RLS gates every statement.';

revoke execute on function public.create_deduction_with_receipt(jsonb, text) from public;
grant execute on function public.create_deduction_with_receipt(jsonb, text) to authenticated;
