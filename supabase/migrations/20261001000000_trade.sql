-- Share and ETF trades: a member's manually recorded buys and sells.
--
-- Holdings, cost base, FIFO parcel matching, realised gains, and the CGT discount
-- are all derived from these rows in `@nest/tax`, so editing or deleting a trade
-- recalculates every figure and nothing derived is stored. Money is integer cents
-- in bigint columns; units are fractional-capable (`numeric`). A trade is keyed by
-- `source` and `external_id` exactly as `transactions` is, leaving room for a
-- brokerage import to upsert its own trades without duplicating. RLS on household
-- membership is the isolation boundary, and a composite foreign key on
-- (member_id, household_id) keeps the reference inside the household.

create type public.trade_side as enum ('buy', 'sell');
comment on type public.trade_side is 'Whether a trade acquires units (buy) or disposes of them (sell).';

create table public.trade (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  ticker text not null check (ticker = upper(btrim(ticker)) and ticker <> ''),
  side public.trade_side not null,
  traded_on date not null,
  units numeric(20, 6) not null check (units > 0),
  price_per_unit_cents bigint not null check (price_per_unit_cents >= 0),
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  source public.ledger_source not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
create index on public.trade (household_id);
create index on public.trade (member_id, household_id);
comment on table public.trade is 'A member''s buy or sell of a share or ETF; holdings, cost base, and realised capital gains are derived from these rows.';
comment on column public.trade.ticker is 'The instrument''s ticker, stored upper-case and trimmed (e.g. VAS).';
comment on column public.trade.side is 'Whether the trade is a buy or a sell.';
comment on column public.trade.traded_on is 'The trade date; a parcel''s holding period for the CGT discount runs from its buy date to the sell date.';
comment on column public.trade.units is 'Units traded, up to six decimal places; always positive (the side gives the direction).';
comment on column public.trade.price_per_unit_cents is 'Price per unit in integer cents, excluding brokerage; never negative.';
comment on column public.trade.fee_cents is 'Brokerage in integer cents: added to a buy''s cost base, deducted from a sell''s proceeds.';
comment on column public.trade.source is 'Where the trade came from: manual for hand-entered, or the brokerage a later import reads it from.';
comment on column public.trade.external_id is 'The source''s own id for the trade, unique per source; null for a manual trade.';

-- ── updated_at trigger ─────────────────────────────────────────────────────────

create trigger set_updated_at before update on public.trade
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.trade enable row level security;

create policy "household members manage trades" on public.trade
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.trade to authenticated;

-- The EOFY share view (eofy-share) reads a household's trades on a service-role
-- client to estimate the shared year's net capital gain; service_role bypasses RLS
-- but still needs the table-level grant. Read-only.
grant select on public.trade to service_role;
