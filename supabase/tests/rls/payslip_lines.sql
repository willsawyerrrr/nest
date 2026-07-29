-- Assertions for the lines a payslip is reconciled through.
--
-- A line states its own kind: an `earning` measured against the inflow it draws
-- on, or a `tax` line measured against the component of the estimated liability
-- it pays. This script rebuilds the shape the table had before either existed —
-- an untyped line beside a slip carrying its own `source_inflow_id` — and runs
-- both migrations over it, asserting that every stored line becomes an earning
-- with its super decision intact and that the slip's own inflow reference is
-- gone. It then holds each kind to its pairing constraint and saves both kinds
-- through the RPC.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
\set KIND_MIGRATION ../../migrations/20260818000000_payslip_line_kind.sql
\set LINES_ONLY_MIGRATION ../../migrations/20260818010000_payslip_reconciles_through_its_lines.sql
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'lines@example.com');

-- ── One household with a salary, an allowance, and one slip ───────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","email":"lines@example.com"}', true);
select public.create_household('Payroll', 'Pia') as pl_hid \gset
select set_config('pl.hid', :'pl_hid', false);
select id as pl_mid from public.members
  where household_id = current_setting('pl.hid')::uuid \gset
select set_config('pl.mid', :'pl_mid', false);

insert into public.inflows (household_id, member_id, name, type, schedule, amount_cents)
  values (current_setting('pl.hid')::uuid, current_setting('pl.mid')::uuid,
    'Acme salary', 'salary', 'fortnightly', 5_000_00)
  returning id as pl_salary \gset
select set_config('pl.salary', :'pl_salary', false);

insert into public.inflows (household_id, member_id, name, type, schedule, amount_cents, attracts_super)
  values (current_setting('pl.hid')::uuid, current_setting('pl.mid')::uuid,
    'On-call (T1)', 'other', 'fortnightly', 450_00, false)
  returning id as pl_on_call \gset
select set_config('pl.on_call', :'pl_on_call', false);

-- The real fortnight: $5,495.50 gross, $1,850.00 of tax over PAYG and STSL.
insert into public.payslip
    (household_id, member_id, financial_year, period_start, period_end, paid_on,
     gross_cents, tax_withheld_cents, super_cents, net_cents)
  values (current_setting('pl.hid')::uuid, current_setting('pl.mid')::uuid, 2027,
    '2026-06-27', '2026-07-10', '2026-07-13', 5_495_50, 1_850_00, 600_00, 3_645_50)
  returning id as pl_slip \gset
select set_config('pl.slip', :'pl_slip', false);

-- ── The shape before a line had a kind ────────────────────────────────────────
--
-- Rebuilt as the table's owner, since the pairing constraint and the enums it
-- reads are exactly what is being put back. The snapshot trigger reads `kind`, so
-- it is switched off while the untyped rows go in and switched back on before the
-- migration runs.

reset role;
alter table public.payslip_line drop constraint payslip_line_kind_attribution;
alter table public.payslip_line drop column kind;
alter table public.payslip_line drop column tax_component;
drop type public.payslip_line_kind;
drop type public.payslip_tax_component;
alter table public.payslip_line alter column attracts_super set not null;
alter table public.payslip add column source_inflow_id uuid;
alter table public.payslip_line disable trigger snapshot_attracts_super;

insert into public.payslip_line
    (household_id, payslip_id, source_inflow_id, label, amount_cents, attracts_super)
  values
    (current_setting('pl.hid')::uuid, current_setting('pl.slip')::uuid,
      current_setting('pl.salary')::uuid, 'Ordinary Hours', 5_000_00, true),
    (current_setting('pl.hid')::uuid, current_setting('pl.slip')::uuid,
      current_setting('pl.on_call')::uuid, 'On-call (T1)', 495_50, false);

update public.payslip set source_inflow_id = current_setting('pl.salary')::uuid
  where id = current_setting('pl.slip')::uuid;

alter table public.payslip_line enable trigger snapshot_attracts_super;

-- ── The migrations, run from the files themselves ─────────────────────────────

\ir :KIND_MIGRATION

do $$ begin
  assert (select count(*) from public.payslip_line where kind = 'earning') = 2,
    'every line written before the kind existed should become an earnings line';
  assert (select count(*) from public.payslip_line where tax_component is not null) = 0,
    'a converted earnings line should name no tax component';
  assert (select attracts_super from public.payslip_line where label = 'Ordinary Hours'),
    'converting a line must not change what it recorded about super';
  assert not (select attracts_super from public.payslip_line where label = 'On-call (T1)'),
    'converting an allowance line must keep it out of the super base';
  assert exists (
    select 1 from pg_constraint
    where conname = 'payslip_line_kind_attribution'
      and conrelid = 'public.payslip_line'::regclass),
    'the pairing constraint should hold each kind to its own columns';
end $$;

\ir :LINES_ONLY_MIGRATION

do $$ begin
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payslip'
      and column_name = 'source_inflow_id'),
    'a payslip should carry no inflow of its own: its lines carry that';
  assert (select count(*) from public.payslip_line) = 2,
    'dropping the slip''s own reference must leave its lines alone';
end $$;

-- Both migrations are idempotent, so a re-run over their own result writes
-- nothing and errors on nothing.
\ir :KIND_MIGRATION
\ir :LINES_ONLY_MIGRATION

do $$ begin
  assert (select count(*) from public.payslip_line where kind = 'earning') = 2,
    'a second run of the migrations should leave the converted lines as they are';
end $$;

-- ── Each kind is held to the columns that mean anything for it ────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","email":"lines@example.com"}', true);

do $$
declare
  v_hid uuid := current_setting('pl.hid')::uuid;
  v_slip uuid := current_setting('pl.slip')::uuid;
  v_salary uuid := current_setting('pl.salary')::uuid;
begin
  begin
    insert into public.payslip_line (household_id, payslip_id, kind, tax_component, source_inflow_id, label, amount_cents)
      values (v_hid, v_slip, 'tax', 'payg', v_salary, 'PAYG', 1_416_00);
    raise exception 'FAIL: a tax line was filed against a projected inflow';
  exception when check_violation then
    raise notice 'PASS: a tax line pays a component, so it names no inflow';
  end;

  begin
    insert into public.payslip_line (household_id, payslip_id, kind, tax_component, label, amount_cents)
      values (v_hid, v_slip, 'earning', 'payg', 'Ordinary Hours', 5_000_00);
    raise exception 'FAIL: an earnings line claimed to pay a tax component';
  exception when check_violation then
    raise notice 'PASS: an earnings line draws on an inflow, so it names no component';
  end;

  begin
    insert into public.payslip_line (household_id, payslip_id, kind, tax_component, label, amount_cents, attracts_super)
      values (v_hid, v_slip, 'tax', 'payg', 'PAYG', 1_416_00, true);
    raise exception 'FAIL: a tax line carried an ordinary-time-earnings decision';
  exception when check_violation then
    raise notice 'PASS: a tax line earns no super, so it carries no decision about it';
  end;

  begin
    insert into public.payslip_line (household_id, payslip_id, kind, label, amount_cents)
      values (v_hid, v_slip, 'tax', 'TAX', 1_850_00);
    raise exception 'FAIL: a tax line named no component to be measured against';
  exception when check_violation then
    raise notice 'PASS: a tax line must name the component it pays';
  end;
end $$;

-- A tax line written properly keeps its component and stays out of the super
-- question entirely: the snapshot trigger is an earnings line's alone.
insert into public.payslip_line (household_id, payslip_id, kind, tax_component, label, amount_cents)
  values
    (current_setting('pl.hid')::uuid, current_setting('pl.slip')::uuid, 'tax', 'payg', 'PAYG', 1_416_00),
    (current_setting('pl.hid')::uuid, current_setting('pl.slip')::uuid, 'tax', 'stsl', 'STSL Component', 434_00);

do $$ begin
  assert (select count(*) from public.payslip_line where kind = 'tax') = 2,
    'a slip should carry a tax line per component its TAX section prints';
  assert (select count(*) from public.payslip_line
    where kind = 'tax' and attracts_super is not null) = 0,
    'the snapshot trigger must leave a tax line''s super decision unset';
  assert (select sum(amount_cents) from public.payslip_line where kind = 'tax')
    = (select tax_withheld_cents from public.payslip where id = current_setting('pl.slip')::uuid),
    'the slip''s tax lines should sum to the total it prints';
end $$;

-- An earnings line still snapshots the decision from the inflow it draws on.
insert into public.payslip_line (household_id, payslip_id, source_inflow_id, label, amount_cents)
  values (current_setting('pl.hid')::uuid, current_setting('pl.slip')::uuid,
    current_setting('pl.on_call')::uuid, 'On-call (T2)', 100_00)
  returning id as pl_line \gset
select set_config('pl.line', :'pl_line', false);
do $$
declare v_id uuid := current_setting('pl.line')::uuid;
begin
  assert (select kind from public.payslip_line where id = v_id) = 'earning',
    'a line written without a kind is the earning an unqualified line is';
  assert not (select attracts_super from public.payslip_line where id = v_id),
    'an earnings line should snapshot its inflow''s super treatment';
end $$;

-- ── The RPC writes both kinds in one call ─────────────────────────────────────

select public.upsert_payslip_with_lines(
  jsonb_build_object(
    'id', gen_random_uuid(),
    'household_id', current_setting('pl.hid'),
    'member_id', current_setting('pl.mid'),
    'financial_year', 2027,
    'period_start', '2026-07-11',
    'period_end', '2026-07-24',
    'paid_on', '2026-07-27',
    'gross_cents', 5_495_50,
    'tax_withheld_cents', 1_850_00,
    'super_cents', 600_00,
    'net_cents', 3_645_50
  ),
  jsonb_build_array(
    -- No kind: an unqualified line is an earning, as it always was.
    jsonb_build_object(
      'source_inflow_id', current_setting('pl.salary'),
      'label', 'Ordinary Hours', 'amount_cents', 5_000_00),
    jsonb_build_object(
      'kind', 'earning', 'source_inflow_id', current_setting('pl.on_call'),
      'label', 'On-call (T1)', 'amount_cents', 495_50),
    jsonb_build_object(
      'kind', 'tax', 'tax_component', 'payg', 'label', 'PAYG', 'amount_cents', 1_416_00),
    jsonb_build_object(
      'kind', 'tax', 'tax_component', 'stsl', 'label', 'STSL Component', 'amount_cents', 434_00)
  )
) as pl_rpc_slip \gset
select set_config('pl.rpc_slip', :'pl_rpc_slip', false);

do $$
declare v_id uuid := current_setting('pl.rpc_slip')::uuid;
begin
  assert (select count(*) from public.payslip_line
    where payslip_id = v_id and kind = 'earning') = 2,
    'the RPC should write the slip''s earnings lines';
  assert (select count(*) from public.payslip_line
    where payslip_id = v_id and kind = 'tax') = 2,
    'the RPC should write the slip''s tax lines beside them';
  assert (select array_agg(tax_component order by tax_component)
    from public.payslip_line where payslip_id = v_id and kind = 'tax')
    = array['payg', 'stsl']::public.payslip_tax_component[],
    'each tax line should record the component it pays';
  assert not (select attracts_super from public.payslip_line
    where payslip_id = v_id and label = 'On-call (T1)'),
    'an earnings line written through the RPC should snapshot its inflow''s super treatment';
  assert (select count(*) from public.payslip_line
    where payslip_id = v_id and kind = 'tax' and attracts_super is not null) = 0,
    'a tax line written through the RPC should carry no super decision';
end $$;

rollback;
