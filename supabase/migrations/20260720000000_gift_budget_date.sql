-- A per-budget date override for the gift tracker.
--
-- `gift_occasion.occasion_date` is a shared default (e.g. Christmas falls on one
-- date for everyone). Birthdays, though, differ per recipient, so the specific
-- date belongs on the recipient × occasion pairing, not the shared occasion.

alter table public.gift_budget
  add column event_date date;
comment on column public.gift_budget.event_date is 'The specific date for this recipient''s occasion (e.g. this person''s birthday); falls back to the occasion''s occasion_date when null.';
