-- One deduction and its already-uploaded receipts written in a single transaction.
--
-- The add-deduction form lets a member pick receipt files as the FIRST step,
-- before the deduction row exists: the form mints the deduction id client-side
-- and each picked file uploads immediately to the private `receipts` bucket
-- under that id (Storage has no foreign key, so this is safe pre-creation).
-- `deduction_receipt.deduction_id` IS a real, non-deferrable foreign key, so a
-- receipt row cannot be inserted until the deduction row exists — writing the
-- two as separate calls would leave an uploaded file with no receipt row if the
-- first call landed and the second did not. This RPC does the whole save in one
-- call, so a failure leaves nothing half-written: no deduction with receipts
-- silently missing, and no receipt row orphaned from a deduction that never
-- landed.
--
-- It is also idempotent. The deduction row is keyed on the id the caller mints,
-- so pressing Save again after a failure rewrites the same row rather than
-- duplicating it; its receipts carry no identity a form tracks per row (they
-- are simply every object already uploaded when the member saves), so the
-- stored set is replaced rather than reconciled — exactly as
-- `upsert_payslip_with_lines` replaces a slip's lines.
--
-- Only the CREATE flow uses this RPC. Editing an existing deduction attaches
-- receipts to its already-real id through the ordinary `deduction_receipt`
-- insert path, so no id-minting complexity applies there.
--
-- SECURITY INVOKER (the default): the caller is the PWA under its own JWT, so
-- the household policies on `deduction` and `deduction_receipt` gate every
-- statement here exactly as they gate a direct write. Nothing is elevated; the
-- transaction is the only thing being bought.

create function public.create_deduction_with_receipts(p_deduction jsonb, p_receipts jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := coalesce(nullif(p_deduction ->> 'id', '')::uuid, gen_random_uuid());
  v_household_id uuid := (p_deduction ->> 'household_id')::uuid;
begin
  insert into public.deduction (
    id, household_id, member_id, description, amount_cents, deduction_date, financial_year
  )
  values (
    v_id,
    v_household_id,
    (p_deduction ->> 'member_id')::uuid,
    p_deduction ->> 'description',
    (p_deduction ->> 'amount_cents')::bigint,
    (p_deduction ->> 'deduction_date')::date,
    (p_deduction ->> 'financial_year')::integer
  )
  -- household_id is deliberately not updatable: it is the RLS boundary, and a
  -- deduction does not move households. A conflict on an id outside the
  -- caller's own household fails the update policy rather than being rewritten.
  on conflict (id) do update set
    member_id = excluded.member_id,
    description = excluded.description,
    amount_cents = excluded.amount_cents,
    deduction_date = excluded.deduction_date,
    financial_year = excluded.financial_year;

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

comment on function public.create_deduction_with_receipts(jsonb, jsonb) is 'Writes one deduction and its already-uploaded receipts in a single transaction, keyed on the caller-minted id so a retried save rewrites the deduction instead of duplicating it. Runs as the caller, so household RLS gates every statement.';

revoke execute on function public.create_deduction_with_receipts(jsonb, jsonb) from public;
grant execute on function public.create_deduction_with_receipts(jsonb, jsonb) to authenticated;
