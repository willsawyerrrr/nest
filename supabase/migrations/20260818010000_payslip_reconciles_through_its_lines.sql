-- A payslip's lines are the whole of its reconciliation.
--
-- A line already names the inflow its earning draws on, and per-inflow variance is
-- measured from those names. A single `payslip.source_inflow_id` beside them says
-- the same thing less well: one payment routinely covers several projections, so
-- the slip-wide pick is either a duplicate of the largest line's inflow or a
-- contradiction of it, and nothing can tell which. The pay cycle the whole-slip
-- expectations are divided by is read from the lines instead — the inflow of the
-- largest earnings group — so the two ways of saying where a slip's pay came from
-- collapse into the one the slip itself prints.
--
-- The lines' own `source_inflow_id` is untouched; it is the payslip's that goes,
-- along with the composite foreign key and the index that served it.

comment on table public.payslip is 'One pay event''s actual figures for a member, itemised into the earnings and tax lines each measured against its own projection.';

alter table public.payslip drop column if exists source_inflow_id;

-- The RPC is rewritten around the same two changes: the slip no longer carries an
-- inflow, and a line states its kind and — for a tax line — the liability
-- component it pays. A payload omitting `kind` writes an earnings line, which is
-- what an unqualified line on a slip is and what every line written before the
-- kind existed was.
create or replace function public.upsert_payslip_with_lines(p_payslip jsonb, p_lines jsonb)
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
    ytd_gross_cents, ytd_tax_withheld_cents, ytd_super_cents, file_path, note
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
    -- An absent path means no new document was attached, which leaves the one
    -- already filed against the slip in place.
    file_path = coalesce(excluded.file_path, public.payslip.file_path),
    note = excluded.note;

  -- The lines are always saved as one whole set — they carry no identity a form
  -- tracks per row — so the stored set is replaced rather than reconciled.
  delete from public.payslip_line where payslip_id = v_id;

  insert into public.payslip_line (
    household_id, payslip_id, kind, source_inflow_id, tax_component, label, amount_cents
  )
  select
    v_household_id,
    v_id,
    coalesce(nullif(line ->> 'kind', ''), 'earning')::public.payslip_line_kind,
    nullif(line ->> 'source_inflow_id', '')::uuid,
    nullif(line ->> 'tax_component', '')::public.payslip_tax_component,
    line ->> 'label',
    (line ->> 'amount_cents')::bigint
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as line;

  return v_id;
end;
$$;

comment on function public.upsert_payslip_with_lines(jsonb, jsonb) is 'Writes one payslip and replaces its earnings and tax lines in a single transaction, keyed on the caller-minted id so a retried save rewrites the slip instead of duplicating it. Runs as the caller, so household RLS gates every statement.';
