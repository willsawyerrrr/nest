-- `create_deduction_with_receipts` carries the deduction's entry basis.
--
-- The add form writes every new deduction through this function, so a column it
-- does not name is a column the add path cannot set. `basis` and `distance_km`
-- were added to `deduction` after the function was written, which left a
-- work-travel deduction added here saving as `basis = 'amount'` with no
-- distance: the dollar figure survived (the form computes `amount_cents` before
-- submitting, and that is what is read downstream) but the kilometres behind it
-- did not, so reopening the deduction offered the dollar control and the list
-- showed no distance beside its date. The row also passed
-- `deduction_basis_attribution` while saying something untrue — a distance
-- claim recorded as a typed dollar amount.
--
-- `basis` defaults to `'amount'` where the payload omits it, which keeps the
-- column's own default meaning for any caller that predates the basis.

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
    basis, distance_km
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
    (p_deduction ->> 'distance_km')::numeric
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
    distance_km = excluded.distance_km;

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

comment on function public.create_deduction_with_receipts(jsonb, jsonb) is 'Writes one deduction and its already-uploaded receipts in a single transaction, keyed on the caller-minted id so a retried save rewrites the deduction instead of duplicating it. Carries the deduction''s entry basis and, on the distance basis, the kilometres claimed. Runs as the caller, so household RLS gates every statement.';
