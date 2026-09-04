-- Joint income: a recurring taxable `other` inflow both partners are assessed on.
--
-- Joint bank or savings-account interest, dividends on a jointly-held parcel, the
-- net rent on a jointly-owned property: income the ATO assesses on both partners,
-- each on their share. Tagged wholly to one `member_id` it overstates that
-- member's marginal tax and understates the other's.
--
-- `is_joint` marks such an inflow and `member_split_percent` is the share assessed
-- to `member_id` — the "primary" member — with the household's other member (there
-- are always exactly two) assessed the remainder. The percentage is configurable
-- rather than a fixed 50/50 so an unequally-owned asset — a rental owned 70/30 —
-- is modelled correctly.
--
-- Only a recurring taxable `other` inflow can be joint: salary and wage are
-- inherently one person's, and a one-off (a joint capital distribution) is out of
-- scope. `member_split_percent` is non-null exactly when `is_joint`, and 0–100
-- when set. The split is a tax-adapter reading — the FY estimate emits two `other`
-- income inputs for a joint inflow — and touches no projection: the whole amount
-- is still the household's projected cash.

alter table public.inflows
  add column is_joint boolean not null default false,
  add column member_split_percent integer;

-- `is_joint` is confined to a recurring taxable `other` inflow, and
-- `member_split_percent` tracks it exactly: present and in range when joint,
-- absent otherwise. A column added later takes its own place in the joint branch
-- or has none, the same shape `inflows_one_off_shape` uses.
alter table public.inflows add constraint inflows_joint_split check (
  case when is_joint then
    taxable
    and type = 'other'
    and paid_on is null
    and member_split_percent is not null
    and member_split_percent between 0 and 100
  else member_split_percent is null end
);

comment on column public.inflows.is_joint is 'Whether this recurring taxable `other` inflow is income both partners are assessed on (joint interest, jointly-held dividends, a jointly-owned rental). The FY tax estimate then splits its annualised amount between `member_id` and the household''s other member; every projection still reads the whole amount. False on salary, wage, non-taxable, and one-off inflows, none of which can be joint.';
comment on column public.inflows.member_split_percent is 'The share of a joint inflow assessed to `member_id`, as a whole-number percentage 0–100; the household''s other member is assessed the remainder. Non-null exactly when `is_joint`.';
