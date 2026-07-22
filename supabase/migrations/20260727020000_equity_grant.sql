-- Startup equity: a member's option and share grants with a vesting schedule.
--
-- Each grant vests over a period after a cliff, and its vested portion carries a
-- value at the current user-maintained price per share (a 409A-equivalent fair
-- value). That vested value feeds the net-worth view as an asset. A member may
-- hold many grants, so this is a collection rather than one row per member.
-- Money is integer cents in bigint columns; quantities are whole units. RLS on
-- household membership is the isolation boundary, and a composite foreign key on
-- (member_id, household_id) keeps the reference inside the household.

create table public.equity_grant (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  label text not null,
  instrument_type text not null check (instrument_type in ('option', 'share')),
  quantity bigint not null check (quantity >= 0),
  grant_date date not null,
  cliff_months int not null default 12 check (cliff_months >= 0),
  vesting_period_months int not null default 48 check (vesting_period_months > 0),
  vesting_frequency text not null default 'monthly'
    check (vesting_frequency in ('monthly', 'quarterly', 'annual')),
  strike_price_cents bigint check (strike_price_cents >= 0),
  price_per_share_cents bigint not null default 0 check (price_per_share_cents >= 0),
  price_as_of date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
create index on public.equity_grant (household_id);
comment on table public.equity_grant is 'A member''s startup equity grant (options or shares) with a cliff and vesting schedule; its vested value counts toward net worth as an asset.';
comment on column public.equity_grant.label is 'Human-readable name for the grant (e.g. the round or grant date).';
comment on column public.equity_grant.instrument_type is 'Whether the grant is options (exercisable at the strike) or shares held outright.';
comment on column public.equity_grant.quantity is 'Whole number of options or shares granted; never negative.';
comment on column public.equity_grant.grant_date is 'The date the grant was made, from which the cliff and vesting are measured.';
comment on column public.equity_grant.cliff_months is 'Months from the grant date before any of the grant vests; typically a whole multiple of the vesting interval.';
comment on column public.equity_grant.vesting_period_months is 'Total months over which the grant vests in full.';
comment on column public.equity_grant.vesting_frequency is 'How often tranches vest after the cliff: monthly, quarterly, or annual.';
comment on column public.equity_grant.strike_price_cents is 'Per-share exercise price in integer cents for options; null for shares.';
comment on column public.equity_grant.price_per_share_cents is 'User-maintained current fair value per share in integer cents (409A-equivalent); never negative.';
comment on column public.equity_grant.price_as_of is 'The date the price per share was last confirmed; null when never set.';

-- ── updated_at trigger ─────────────────────────────────────────────────────────

create trigger set_updated_at before update on public.equity_grant
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.equity_grant enable row level security;

create policy "household members manage equity grants" on public.equity_grant
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.equity_grant to authenticated;
