-- A recurring inflow's confirmed payday, so the calendar feed can anchor its
-- occurrences on a real date instead of a placeholder guess.
--
-- `starts_on` says when an inflow becomes effective and prorates the FY tax
-- estimate by calendar days; it is not necessarily the day money first lands —
-- an inflow effective from 1 July might not actually pay until the 11th.
-- `pay_anchor_date` is the separate fact: one date the household confirms the
-- inflow's money actually lands on, from which the calendar feed steps the
-- cadence forward and backward. It touches calendar placement only —
-- annualisation, the tax estimate, and the fortnightly budget all keep
-- reading `schedule`, never a payday.
--
-- Nullable, with no backfill forced on existing inflows: one with no confirmed
-- payday keeps stepping from the fixed epoch it always has. Null on a one-off,
-- which has no cadence to anchor and already carries its own date in `paid_on`.

alter table public.inflows
  add column pay_anchor_date date;

-- Everything a cadence needs is absent from a one-off; `pay_anchor_date` takes
-- its place in that same list alongside `starts_on` and `ends_on`.
alter table public.inflows drop constraint if exists inflows_one_off_shape;
alter table public.inflows add constraint inflows_one_off_shape check (
  case when paid_on is not null then
    interval_count is null
    and pay_schedule is null
    and pay_interval_count is null
    and starts_on is null
    and ends_on is null
    and pay_anchor_date is null
    and arrives_every_pay_period
    and type <> 'wage'
  else true end
);

comment on column public.inflows.pay_anchor_date is 'One confirmed date this recurring inflow''s money actually lands on, which the calendar feed steps its cadence forward and backward from; distinct from `starts_on`, which is the effective-from date and may differ from the first real payday. Null on a one-off, which has no cadence to anchor.';
