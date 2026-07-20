-- Medication tracker: the second consumer of derived budget lines.
--
-- Each medication carries a cost on a recurring frequency. Their annualised costs
-- sum into a single `derived_source = 'medication'` budget line in the Needs
-- group, so the line and the tracker stay one source of truth. Isolation matches
-- the ledger — RLS on household membership.

create table public.medication (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  dose text,
  amount_cents bigint not null,
  frequency public.frequency not null,
  interval_weeks int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_interval_weeks check (
    case frequency
      when 'every_n_weeks' then interval_weeks is not null and interval_weeks >= 1
      else interval_weeks is null
    end
  )
);
create index on public.medication (household_id);
comment on table public.medication is 'A medication with a recurring cost; the annualised costs roll up into the household''s Needs medication budget line.';
comment on column public.medication.dose is 'Informational dose label (e.g. "50 mg daily"); not used in the cost roll-up.';
comment on column public.medication.interval_weeks is 'Weeks between costs for the every_n_weeks frequency; null for every other frequency.';

-- ── updated_at trigger ───────────────────────────────────────────────────────

create trigger set_updated_at before update on public.medication
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.medication enable row level security;

create policy "household members manage medications" on public.medication
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.medication to authenticated;
