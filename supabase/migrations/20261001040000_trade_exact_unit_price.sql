-- A trade's unit price is held exactly, not rounded to whole cents.
--
-- Brokers print a security's average price to six decimal places (33.083072),
-- which integer cents cannot hold. `price_per_unit_microdollars` is the price as
-- an integer count of microdollars — millionths of a dollar — in a bigint, so it
-- stays an exact integer end to end with no float or decimal in between. Every
-- other money column in the schema stays in integer cents; securities are the
-- only place sub-cent amounts arise.
--
-- A cent is 10,000 microdollars, so each existing price is multiplied by 10,000:
-- the value is unchanged, only its scale. The column is retyped in place rather
-- than added and copied, so no row is updated and `updated_at` does not move.

alter table public.trade rename column price_per_unit_cents to price_per_unit_microdollars;
alter table public.trade alter column price_per_unit_microdollars type bigint
  using price_per_unit_microdollars * 10000;
alter table public.trade rename constraint trade_price_per_unit_cents_check
  to trade_price_per_unit_microdollars_check;

comment on column public.trade.price_per_unit_microdollars is 'Exact price per unit in integer microdollars (millionths of a dollar; 10,000 per cent), excluding brokerage; never negative. Whole-cent figures derived from it are rounded half-up once, at the point a dollar amount is produced.';

-- ── Saving the trades read from one document ─────────────────────────────────

create or replace function public.create_trades_with_document(
  p_household_id uuid,
  p_document_id uuid,
  p_document_path text,
  p_trades jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.trade_document (id, household_id, storage_path)
  values (p_document_id, p_household_id, p_document_path)
  on conflict (id) do nothing;

  -- A retried save replays the same caller-minted trade ids, so rows already
  -- written are skipped rather than duplicated.
  with inserted as (
    insert into public.trade (
      id, household_id, member_id, ticker, side, traded_on, units,
      price_per_unit_microdollars, fee_cents, document_id
    )
    select
      (t ->> 'id')::uuid,
      p_household_id,
      (t ->> 'member_id')::uuid,
      t ->> 'ticker',
      (t ->> 'side')::public.trade_side,
      (t ->> 'traded_on')::date,
      (t ->> 'units')::numeric,
      (t ->> 'price_per_unit_microdollars')::bigint,
      coalesce((t ->> 'fee_cents')::bigint, 0),
      p_document_id
    from jsonb_array_elements(p_trades) as t
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;
