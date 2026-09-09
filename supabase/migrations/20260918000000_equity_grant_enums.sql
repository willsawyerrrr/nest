-- Convert equity_grant.instrument_type and .vesting_frequency from
-- CHECK-constrained `text` to real Postgres enums.
--
-- As `text` + CHECK, `supabase gen types` widens both to `string`, so the app's
-- `EquityInstrumentType` / `VestingFrequency` domain aliases are transcribed from
-- the CHECK by hand and the WSD-147 drift guards can only compare a hand-kept
-- union against `@nest/plan`. As enums the generated types carry the values and
-- the aliases derive straight from the schema.

create type public.equity_instrument_type as enum ('option', 'share');
create type public.equity_vesting_frequency as enum ('monthly', 'quarterly', 'annual');

comment on type public.equity_instrument_type
  is 'Whether an equity grant is options (exercisable at the strike) or shares held outright.';
comment on type public.equity_vesting_frequency
  is 'How often an equity grant''s tranches vest after the cliff: monthly, quarterly, or annual.';

-- instrument_type carries no default; drop the CHECK and swap the column type.
alter table public.equity_grant drop constraint if exists equity_grant_instrument_type_check;
alter table public.equity_grant
  alter column instrument_type type public.equity_instrument_type
  using instrument_type::public.equity_instrument_type;

-- vesting_frequency carries `default 'monthly'`, which references the old type,
-- so drop it around the swap and restore it after.
alter table public.equity_grant alter column vesting_frequency drop default;
alter table public.equity_grant drop constraint if exists equity_grant_vesting_frequency_check;
alter table public.equity_grant
  alter column vesting_frequency type public.equity_vesting_frequency
  using vesting_frequency::public.equity_vesting_frequency;
alter table public.equity_grant alter column vesting_frequency set default 'monthly';
