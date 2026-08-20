-- `create_deduction_with_receipts` carries the group a new deduction is filed in.
--
-- The add form writes every new deduction through this function, and the
-- function names its columns explicitly, so a column it does not name is a
-- column the add path cannot set. `group_id` was added to `deduction` after the
-- function was written, which left an invoice added from a subscription's own
-- row saving with no group: the client sent it, the function dropped it, and the
-- payment appeared in the ungrouped list underneath instead of in the group it
-- was added to. Only a later edit — a plain field update, which does not go
-- through this function — could put it where it belonged.
--
-- This is the second column to be lost this way, so the shape is worth naming:
-- an explicit column list here has to be revisited by every migration that adds
-- a column the add form can set.

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
    basis, distance_km, group_id
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
    nullif(p_deduction ->> 'group_id', '')::uuid
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
    group_id = excluded.group_id;

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

comment on function public.create_deduction_with_receipts(jsonb, jsonb) is 'Writes one deduction and its already-uploaded receipts in a single transaction, keyed on the caller-minted id so a retried save rewrites the deduction instead of duplicating it. Carries the deduction''s entry basis, the kilometres behind a distance-basis claim, and the group it is filed under. Runs as the caller, so household RLS gates every statement.';
