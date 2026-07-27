-- Payslips: the actual figures from one pay event, for variance against the plan.
--
-- Inflows project what a member should earn and the tax engine estimates what
-- should be withheld; a payslip carries what actually happened for one pay
-- period — gross, PAYG withheld, super, net, plus the slip's year-to-date running
-- totals. A member has many payslips, so this is a collection tagged to a member
-- and a financial year, exactly as `deduction` is. `source_inflow_id` records
-- which projected inflow the slip reconciles against, chosen by the household.
-- Money is integer cents in bigint columns. An optional attached file lives in
-- the private `payslips` Storage bucket, its access gated by household
-- membership; `file_path` records the object key.

-- ── Payslip ───────────────────────────────────────────────────────────────────

create table public.payslip (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  financial_year integer not null,
  period_start date not null,
  period_end date not null,
  paid_on date,
  gross_cents bigint not null check (gross_cents >= 0),
  tax_withheld_cents bigint not null check (tax_withheld_cents >= 0),
  super_cents bigint not null check (super_cents >= 0),
  net_cents bigint not null check (net_cents >= 0),
  salary_sacrifice_cents bigint check (salary_sacrifice_cents >= 0),
  ytd_gross_cents bigint check (ytd_gross_cents >= 0),
  ytd_tax_withheld_cents bigint check (ytd_tax_withheld_cents >= 0),
  ytd_super_cents bigint check (ytd_super_cents >= 0),
  source_inflow_id uuid,
  file_path text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payslip_period check (period_end >= period_start),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  -- The projected inflow the slip reconciles against. Nullable: a slip need not
  -- map to one, and removing the inflow leaves the actuals intact — the column
  -- list keeps the set-null to the reference, not the not-null household_id.
  foreign key (source_inflow_id, household_id)
    references public.inflows (id, household_id) on delete set null (source_inflow_id),
  -- Lets a future child table composite-FK a payslip inside the same household.
  unique (id, household_id)
);
-- The per-member timeline (most recent first) and the year-to-date summing both
-- read household + member ordered by period; its leading household_id also
-- serves every household-scoped scan and the RLS predicate. The remaining two
-- index the declared foreign keys on (fk_col, household_id), per the schema-wide
-- convention.
create index on public.payslip (household_id, member_id, period_end);
create index on public.payslip (member_id, household_id);
create index on public.payslip (source_inflow_id, household_id);

comment on table public.payslip is 'One pay event''s actual figures for a member, reconciled against the projected inflow and the tax estimate.';
comment on column public.payslip.financial_year is 'AU financial year the pay period falls in, labelled by the ending year.';
comment on column public.payslip.period_start is 'First day of the pay period the slip covers.';
comment on column public.payslip.period_end is 'Last day of the pay period the slip covers; never before period_start.';
comment on column public.payslip.paid_on is 'The date the pay landed, when the slip states it.';
comment on column public.payslip.gross_cents is 'Gross earnings for the period, in integer cents; never negative.';
comment on column public.payslip.tax_withheld_cents is 'PAYG tax withheld for the period; zero when nothing was withheld.';
comment on column public.payslip.super_cents is 'Employer super guarantee for the period.';
comment on column public.payslip.net_cents is 'Net pay for the period.';
comment on column public.payslip.salary_sacrifice_cents is 'Concessional salary sacrifice shown on the slip; null when the slip shows none.';
comment on column public.payslip.ytd_gross_cents is 'Year-to-date gross as printed on the slip; null when not entered.';
comment on column public.payslip.ytd_tax_withheld_cents is 'Year-to-date PAYG withheld as printed on the slip; null when not entered.';
comment on column public.payslip.ytd_super_cents is 'Year-to-date super as printed on the slip; null when not entered.';
comment on column public.payslip.source_inflow_id is 'The projected inflow this slip reconciles against; null when the slip maps to none.';
comment on column public.payslip.file_path is 'Object key in the private `payslips` bucket, prefixed with the household id as its first path segment for the Storage RLS check; null when no file is attached.';
comment on column public.payslip.note is 'Free-text note about the pay event (a bonus, back-pay, a correction).';

create trigger set_updated_at before update on public.payslip
  for each row execute function public.set_updated_at();

alter table public.payslip enable row level security;

-- Household-wide CRUD, deliberately the same boundary as every other per-member
-- tax table (`deduction`, `super_contribution`, `help_debt`, `tax_profile`): the
-- household's money is fully pooled, so `member_id` is a tax/reporting
-- attribution, not a privacy boundary. A payslip is a sensitive document, and the
-- household — not the individual member — is the trust boundary that protects it.
-- This is the intended design, not an oversight in the policy.
create policy "household members manage payslips" on public.payslip
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- The PWA is the only writer and reader: nothing server-side touches payslips, so
-- `service_role` gets no grant.
grant select, insert, update, delete on public.payslip to authenticated;

-- ── Storage: private `payslips` bucket and its household-scoped policies ──────
--
-- Guarded so the block is skipped wherever the `storage` schema is absent; it
-- runs against real Supabase and against the `rls` CI job's Storage shim. Objects
-- are laid out as `<household_id>/<payslip_id>/<file>`, so the first path segment
-- identifies the owning household and gates access to it.
do $$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public)
      values ('payslips', 'payslips', false)
      on conflict (id) do nothing;

    drop policy if exists "household members manage payslip objects" on storage.objects;
    create policy "household members manage payslip objects" on storage.objects
      for all to authenticated
      using (
        bucket_id = 'payslips'
        and ((storage.foldername(name))[1])::uuid
          in (select public.household_ids_for_current_user())
      )
      with check (
        bucket_id = 'payslips'
        and ((storage.foldername(name))[1])::uuid
          in (select public.household_ids_for_current_user())
      );
  end if;
end $$;
