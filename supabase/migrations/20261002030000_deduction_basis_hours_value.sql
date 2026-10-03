-- The `hours` entry basis: the ATO's fixed rate method for working from home.
--
-- The value is added on its own, ahead of the migration that constrains on it,
-- because a new enum value cannot be used until the transaction that added it
-- has committed.

alter type public.deduction_basis add value if not exists 'hours';

comment on type public.deduction_basis is 'How a deduction''s amount_cents was arrived at: ''amount'', entered directly; ''distance'', computed from distance_km at the financial year''s cents-per-km car expense rate; or ''hours'', computed from work_from_home_hours at the financial year''s cents-per-hour working from home rate.';
