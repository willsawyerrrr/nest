-- Effective dates on an inflow, so income that changes partway through a
-- financial year is modelled and prorated correctly.
--
-- An inflow may carry an optional effective start and/or end date. Both null
-- means it applies for the whole financial year. The tax estimate prorates each
-- inflow's annual gross by the fraction of the financial year the inflow is
-- active, counted in inclusive calendar days. A mid-year pay rise is two dated
-- inflows: the old rate ending on its last day and the new rate starting the
-- next day.

alter table public.inflows
  add column starts_on date,
  add column ends_on date;

alter table public.inflows add constraint inflows_effective_dates check (
  ends_on is null or starts_on is null or ends_on >= starts_on
);

comment on column public.inflows.starts_on is 'First day the inflow is active; null means from the start of the financial year. Prorates the FY tax estimate by calendar days.';
comment on column public.inflows.ends_on is 'Last day the inflow is active; null means through the end of the financial year. Prorates the FY tax estimate by calendar days.';
