-- Tax deductions: a member's deductible expenses with optional stored receipts.
--
-- Each deduction is tagged to a household member and a financial year, and its
-- amount reduces that member's taxable income in the tax estimate. A member may
-- claim many deductions, so this is a collection rather than one row per member.
-- Money is integer cents in bigint columns. RLS on household membership is the
-- isolation boundary, and a composite foreign key on (member_id, household_id)
-- keeps the reference inside the household. Receipts are files in a private
-- Supabase Storage bucket; each `deduction_receipt` row records the stored path
-- and original file name, its access likewise gated by household membership.

-- ── Deduction ─────────────────────────────────────────────────────────────────

create table public.deduction (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  description text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  deduction_date date not null,
  financial_year integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  -- Lets the receipt child composite-FK a deduction inside the same household.
  unique (id, household_id)
);
create index on public.deduction (household_id);
create index on public.deduction (member_id);
comment on table public.deduction is 'A member''s deductible expense for a financial year; its amount reduces that member''s taxable income in the tax estimate.';
comment on column public.deduction.description is 'Human-readable description of the deductible expense.';
comment on column public.deduction.amount_cents is 'The deductible amount in integer cents; never negative.';
comment on column public.deduction.deduction_date is 'The date the expense was incurred.';
comment on column public.deduction.financial_year is 'AU financial year the deduction is claimed in, labelled by the ending year.';

create trigger set_updated_at before update on public.deduction
  for each row execute function public.set_updated_at();

alter table public.deduction enable row level security;

create policy "household members manage deductions" on public.deduction
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

grant select, insert, update, delete on public.deduction to authenticated;

-- ── Deduction receipt ──────────────────────────────────────────────────────────

create table public.deduction_receipt (
  id uuid primary key default gen_random_uuid(),
  deduction_id uuid not null,
  household_id uuid not null references public.households on delete cascade,
  storage_path text not null,
  file_name text not null,
  created_at timestamptz not null default now(),
  foreign key (deduction_id, household_id)
    references public.deduction (id, household_id) on delete cascade
);
create index on public.deduction_receipt (deduction_id);
create index on public.deduction_receipt (household_id);
comment on table public.deduction_receipt is 'A stored receipt file backing a deduction; the file lives in the private `receipts` Storage bucket and this row records its path and original name.';
comment on column public.deduction_receipt.storage_path is 'Object key in the `receipts` bucket, prefixed with the household id as its first path segment for the Storage RLS check.';
comment on column public.deduction_receipt.file_name is 'The original uploaded file name, shown in the UI.';

alter table public.deduction_receipt enable row level security;

create policy "household members manage deduction receipts" on public.deduction_receipt
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

grant select, insert, update, delete on public.deduction_receipt to authenticated;

-- ── Storage: private `receipts` bucket and its household-scoped policies ─────────
--
-- Guarded so the `rls` CI job (plain Postgres, no `storage` schema) skips this
-- block; it runs only against real Supabase, where Storage is present. Objects
-- are laid out as `<household_id>/<deduction_id>/<file>`, so the first path
-- segment identifies the owning household and gates access to it.
do $$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public)
      values ('receipts', 'receipts', false)
      on conflict (id) do nothing;

    drop policy if exists "household members manage receipt objects" on storage.objects;
    create policy "household members manage receipt objects" on storage.objects
      for all to authenticated
      using (
        bucket_id = 'receipts'
        and ((storage.foldername(name))[1])::uuid
          in (select public.household_ids_for_current_user())
      )
      with check (
        bucket_id = 'receipts'
        and ((storage.foldername(name))[1])::uuid
          in (select public.household_ids_for_current_user())
      );
  end if;
end $$;
