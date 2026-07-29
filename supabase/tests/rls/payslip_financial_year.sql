-- Assertions for the financial year a payslip is filed under.
--
-- Salary and wages are assessed in the year the money is PAID, so
-- `payslip.financial_year` comes from `paid_on` and falls back to `period_end`
-- only where the slip states no payment date. This script proves the derivation
-- at the 30 June boundary, then rebuilds the pre-sweep state — rows filed by the
-- period they were earned in — and re-runs the backfill migration itself over it,
-- asserting it moves exactly the rows that disagree with the rule, leaves every
-- other row physically untouched, and writes nothing at all on a second pass.
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
\set MIGRATION ../../migrations/20260817000000_payslip_financial_year_by_payment_date.sql
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'pia@example.com');

-- ── The derivation, at and around 30 June ─────────────────────────────────────
do $$ begin
  assert public.payslip_financial_year('2026-07-01', '2026-06-28') = 2027,
    'a fortnight worked to 28 June and paid 1 July belongs to the year it was paid in';
  assert public.payslip_financial_year('2026-06-30', '2026-07-14') = 2026,
    'a period worked into July but paid by 30 June belongs to the earlier year';
  assert public.payslip_financial_year(null, '2026-06-28') = 2026,
    'a slip stating no payment date falls back to its pay period''s last day';
  assert public.payslip_financial_year(null, '2026-07-01') = 2027,
    'the fallback files 1 July under the later year, exactly as a payment date would';
  assert public.payslip_financial_year('2027-06-30', '2027-06-30') = 2027,
    '30 June closes the year labelled with that calendar year';
  assert public.payslip_financial_year('2027-07-01', '2027-06-30') = 2028,
    '1 July opens the year labelled with the following calendar year';
end $$;

-- ── One household, one member, and six slips filed by the old rule ────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","email":"pia@example.com"}', true);
select public.create_household('Payroll', 'Pia') as fy_hid \gset
select set_config('fy.hid', :'fy_hid', false);
select id as fy_mid from public.members
  where household_id = current_setting('fy.hid')::uuid \gset
select set_config('fy.mid', :'fy_mid', false);

-- The pre-sweep state is by definition a state the constraint forbids, so it is
-- built with the constraint off and as the table's owner rather than a member.
reset role;
alter table public.payslip drop constraint payslip_financial_year;

-- `updated_at` is seeded to a date no write in this transaction can produce, so a
-- row the sweep skips is provably untouched: the `set_updated_at` trigger stamps
-- `now()`, which is the transaction's own start time.
insert into public.payslip
    (id, household_id, member_id, financial_year, period_start, period_end, paid_on,
     gross_cents, tax_withheld_cents, super_cents, net_cents, updated_at)
  values
    -- Straddling: earned to 28 June, paid 1 July. Filed under the year the work
    -- fell in; belongs to the year the money landed in.
    ('aaaa0000-0000-0000-0000-000000000001', current_setting('fy.hid')::uuid, current_setting('fy.mid')::uuid,
      2026, '2026-06-15', '2026-06-28', '2026-07-01', 5_000_00, 1_000_00, 600_00, 3_400_00, '2026-01-01'),
    -- Wholly inside FY2027, paid in FY2027: already right.
    ('aaaa0000-0000-0000-0000-000000000002', current_setting('fy.hid')::uuid, current_setting('fy.mid')::uuid,
      2027, '2026-07-01', '2026-07-14', '2026-07-16', 5_000_00, 1_000_00, 600_00, 3_400_00, '2026-01-01'),
    -- No payment date: the pay period end decides, and already did.
    ('aaaa0000-0000-0000-0000-000000000003', current_setting('fy.hid')::uuid, current_setting('fy.mid')::uuid,
      2026, '2026-06-15', '2026-06-28', null, 5_000_00, 1_000_00, 600_00, 3_400_00, '2026-01-01'),
    -- Paid on the last day of the year it was earned in: also already right.
    ('aaaa0000-0000-0000-0000-000000000004', current_setting('fy.hid')::uuid, current_setting('fy.mid')::uuid,
      2026, '2026-06-17', '2026-06-30', '2026-06-30', 5_000_00, 1_000_00, 600_00, 3_400_00, '2026-01-01'),
    -- Straddling the other way: worked into July, paid early on 30 June, so it
    -- moves back into the earlier year.
    ('aaaa0000-0000-0000-0000-000000000005', current_setting('fy.hid')::uuid, current_setting('fy.mid')::uuid,
      2027, '2026-07-01', '2026-07-14', '2026-06-30', 5_000_00, 1_000_00, 600_00, 3_400_00, '2026-01-01'),
    -- No payment date and a year the fallback disagrees with. Repairing it is what
    -- lets the constraint be added over live data at all.
    ('aaaa0000-0000-0000-0000-000000000006', current_setting('fy.hid')::uuid, current_setting('fy.mid')::uuid,
      2027, '2026-06-15', '2026-06-28', null, 5_000_00, 1_000_00, 600_00, 3_400_00, '2026-01-01');

-- ── The backfill, run from the migration itself ───────────────────────────────

\ir :MIGRATION

do $$
declare
  v_moved uuid[] := array['aaaa0000-0000-0000-0000-000000000001',
                          'aaaa0000-0000-0000-0000-000000000005',
                          'aaaa0000-0000-0000-0000-000000000006']::uuid[];
begin
  assert (select financial_year from public.payslip
    where id = 'aaaa0000-0000-0000-0000-000000000001') = 2027,
    'a slip earned to 28 June and paid 1 July should move to FY2027';
  assert (select financial_year from public.payslip
    where id = 'aaaa0000-0000-0000-0000-000000000002') = 2027,
    'a slip earned and paid inside FY2027 should stay in FY2027';
  assert (select financial_year from public.payslip
    where id = 'aaaa0000-0000-0000-0000-000000000003') = 2026,
    'a slip with no payment date should keep the year its pay period decides';
  assert (select financial_year from public.payslip
    where id = 'aaaa0000-0000-0000-0000-000000000004') = 2026,
    'a slip paid on 30 June should stay in the year that closes on it';
  assert (select financial_year from public.payslip
    where id = 'aaaa0000-0000-0000-0000-000000000005') = 2026,
    'a July period paid early on 30 June should move back to FY2026';
  assert (select financial_year from public.payslip
    where id = 'aaaa0000-0000-0000-0000-000000000006') = 2026,
    'a slip with no payment date and a year its period disagrees with should be repaired';

  assert (select count(*) from public.payslip
    where updated_at <> '2026-01-01'::timestamptz and id <> all (v_moved)) = 0,
    'the sweep should write no row that already agrees with the rule';
  assert (select count(*) from public.payslip
    where updated_at = '2026-01-01'::timestamptz and id = any (v_moved)) = 0,
    'the sweep should write every row that disagrees with the rule';
end $$;

-- ── Idempotency: a second pass rewrites nothing ───────────────────────────────
--
-- `now()` is fixed for the whole transaction, so `updated_at` cannot witness a
-- rewrite here; the physical row version can, since an update inside a
-- transaction still moves the row's `ctid`.
create temp table payslip_versions as select id, ctid as row_version from public.payslip;

\ir :MIGRATION

do $$ begin
  assert not exists (
    select 1 from public.payslip p join payslip_versions v using (id)
    where p.ctid <> v.row_version),
    'a second run of the backfill should rewrite no row';
end $$;

-- ── The constraint holds the rule for every future write ──────────────────────

do $$ begin
  update public.payslip set financial_year = 2026
    where id = 'aaaa0000-0000-0000-0000-000000000001';
  raise exception 'FAIL: a slip was re-filed under the year its work fell in';
exception when check_violation then
  raise notice 'PASS: the constraint refuses a year the slip''s dates do not derive';
end $$;

do $$ begin
  insert into public.payslip
      (household_id, member_id, financial_year, period_start, period_end, paid_on,
       gross_cents, tax_withheld_cents, super_cents, net_cents)
    values (current_setting('fy.hid')::uuid, current_setting('fy.mid')::uuid,
      2026, '2026-06-15', '2026-06-28', '2026-07-01', 5_000_00, 1_000_00, 600_00, 3_400_00);
  raise exception 'FAIL: a new slip was filed under the year its work fell in';
exception when check_violation then
  raise notice 'PASS: the constraint refuses a wrongly filed insert';
end $$;

-- A member writing the derived year through the policy is unaffected by any of it.
set local role authenticated;
insert into public.payslip
    (household_id, member_id, financial_year, period_start, period_end, paid_on,
     gross_cents, tax_withheld_cents, super_cents, net_cents)
  values (current_setting('fy.hid')::uuid, current_setting('fy.mid')::uuid,
    2027, '2026-06-15', '2026-06-28', '2026-07-01', 5_000_00, 1_000_00, 600_00, 3_400_00);
do $$ begin
  assert (select count(*) from public.payslip where financial_year = 2027) = 3,
    'a member should file a straddling slip under the year its pay landed in';
end $$;

rollback;
