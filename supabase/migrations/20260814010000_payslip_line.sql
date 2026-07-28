-- Payslip lines: the earnings lines one pay event is made up of.
--
-- A single payment often covers several projected inflows at once — salary plus
-- an on-call allowance, and a second on-call allowance beside it — and one
-- inflow often appears as several lines, since ordinary hours and annual leave
-- both draw on the same salary. A payslip therefore owns many lines, each an
-- amount under the slip's own label with, optionally, the projected inflow it
-- draws on. Variance is measured per inflow: the lines naming one inflow are
-- summed and held against that inflow's expectation for the period, so a lumpy
-- allowance is isolated instead of smearing across the salary. Many lines may
-- name the same inflow, so there is no uniqueness on
-- (payslip_id, source_inflow_id).
--
-- Lines need not sum to the slip's gross_cents; whatever is left over is
-- unallocated and shown as such. Money is integer cents in bigint columns.

create table public.payslip_line (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  payslip_id uuid not null,
  source_inflow_id uuid,
  label text not null,
  amount_cents bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (payslip_id, household_id)
    references public.payslip (id, household_id) on delete cascade,
  -- The projected inflow the line draws on. Nullable: a line the household maps
  -- to no projection (a bonus, back-pay) still records, and retiring the inflow
  -- leaves the line intact — the column list keeps the set-null to the
  -- reference, not the not-null household_id.
  foreign key (source_inflow_id, household_id)
    references public.inflows (id, household_id) on delete set null (source_inflow_id)
);
-- The household scan the PWA loads by, then the two declared foreign keys on
-- (fk_col, household_id), per the schema-wide convention.
create index on public.payslip_line (household_id);
create index on public.payslip_line (payslip_id, household_id);
create index on public.payslip_line (source_inflow_id, household_id);

comment on table public.payslip_line is 'One earnings line on a payslip, optionally drawing on a projected inflow; the lines sharing an inflow are summed into that inflow''s per-period variance.';
comment on column public.payslip_line.payslip_id is 'The pay event the line appears on; the line goes with the slip.';
comment on column public.payslip_line.source_inflow_id is 'The projected inflow the line draws on; null when the household maps it to none. Many lines may name the same inflow.';
comment on column public.payslip_line.label is 'The line''s name as the slip prints it (e.g. Ordinary Hours, Annual Leave, On-call).';
comment on column public.payslip_line.amount_cents is 'The line''s amount in integer cents. Signed, unlike the slip''s own totals: an earnings line may be a negative adjustment reversing an overpayment.';

create trigger set_updated_at before update on public.payslip_line
  for each row execute function public.set_updated_at();

alter table public.payslip_line enable row level security;

-- Household-wide CRUD, matching the parent payslip's boundary exactly: a line is
-- part of the slip it hangs off, and the household — not the individual member —
-- is the trust boundary protecting it.
create policy "household members manage payslip lines" on public.payslip_line
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- The PWA is the only writer and reader, as for `payslip` itself.
grant select, insert, update, delete on public.payslip_line to authenticated;
