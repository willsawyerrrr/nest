-- One payslip and its earnings lines written in a single transaction.
--
-- A slip and its lines are one thing the member saves, and saving them as two
-- calls leaves the pair half-written whenever the second fails: a slip with no
-- lines when a create succeeds and the lines do not, and — worse, on an edit —
-- no lines at all when the clearing delete lands and the insert does not. This
-- RPC does the whole save in one call, so a failure leaves the stored slip
-- exactly as it was.
--
-- It is also idempotent. The row is keyed on the id the caller mints, so pressing
-- Save again after a failure rewrites the same slip rather than duplicating it —
-- a second row would inflate the year-to-date totals and the withholding the tax
-- estimate nets against the liability.
--
-- SECURITY INVOKER (the default): the caller is the PWA under its own JWT, so the
-- household policies on `payslip` and `payslip_line` gate every statement here
-- exactly as they gate a direct write. Nothing is elevated; the transaction is
-- the only thing being bought.

create function public.upsert_payslip_with_lines(p_payslip jsonb, p_lines jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := coalesce(nullif(p_payslip ->> 'id', '')::uuid, gen_random_uuid());
  v_household_id uuid := (p_payslip ->> 'household_id')::uuid;
begin
  insert into public.payslip (
    id, household_id, member_id, financial_year, period_start, period_end, paid_on,
    gross_cents, tax_withheld_cents, super_cents, net_cents, salary_sacrifice_cents,
    ytd_gross_cents, ytd_tax_withheld_cents, ytd_super_cents, source_inflow_id, file_path, note
  )
  values (
    v_id,
    v_household_id,
    (p_payslip ->> 'member_id')::uuid,
    (p_payslip ->> 'financial_year')::integer,
    (p_payslip ->> 'period_start')::date,
    (p_payslip ->> 'period_end')::date,
    (p_payslip ->> 'paid_on')::date,
    (p_payslip ->> 'gross_cents')::bigint,
    (p_payslip ->> 'tax_withheld_cents')::bigint,
    (p_payslip ->> 'super_cents')::bigint,
    (p_payslip ->> 'net_cents')::bigint,
    (p_payslip ->> 'salary_sacrifice_cents')::bigint,
    (p_payslip ->> 'ytd_gross_cents')::bigint,
    (p_payslip ->> 'ytd_tax_withheld_cents')::bigint,
    (p_payslip ->> 'ytd_super_cents')::bigint,
    nullif(p_payslip ->> 'source_inflow_id', '')::uuid,
    p_payslip ->> 'file_path',
    p_payslip ->> 'note'
  )
  -- household_id is deliberately not updatable: it is the RLS boundary, and a
  -- slip does not move households. A conflict on an id outside the caller's own
  -- household fails the update policy rather than being rewritten.
  on conflict (id) do update set
    member_id = excluded.member_id,
    financial_year = excluded.financial_year,
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    paid_on = excluded.paid_on,
    gross_cents = excluded.gross_cents,
    tax_withheld_cents = excluded.tax_withheld_cents,
    super_cents = excluded.super_cents,
    net_cents = excluded.net_cents,
    salary_sacrifice_cents = excluded.salary_sacrifice_cents,
    ytd_gross_cents = excluded.ytd_gross_cents,
    ytd_tax_withheld_cents = excluded.ytd_tax_withheld_cents,
    ytd_super_cents = excluded.ytd_super_cents,
    source_inflow_id = excluded.source_inflow_id,
    -- An absent path means no new document was attached, which leaves the one
    -- already filed against the slip in place.
    file_path = coalesce(excluded.file_path, public.payslip.file_path),
    note = excluded.note;

  -- The lines are always saved as one whole set — they carry no identity a form
  -- tracks per row — so the stored set is replaced rather than reconciled.
  delete from public.payslip_line where payslip_id = v_id;

  insert into public.payslip_line (household_id, payslip_id, source_inflow_id, label, amount_cents)
  select
    v_household_id,
    v_id,
    nullif(line ->> 'source_inflow_id', '')::uuid,
    line ->> 'label',
    (line ->> 'amount_cents')::bigint
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as line;

  return v_id;
end;
$$;

comment on function public.upsert_payslip_with_lines(jsonb, jsonb) is 'Writes one payslip and replaces its earnings lines in a single transaction, keyed on the caller-minted id so a retried save rewrites the slip instead of duplicating it. Runs as the caller, so household RLS gates every statement.';

revoke execute on function public.upsert_payslip_with_lines(jsonb, jsonb) from public;
grant execute on function public.upsert_payslip_with_lines(jsonb, jsonb) to authenticated;
