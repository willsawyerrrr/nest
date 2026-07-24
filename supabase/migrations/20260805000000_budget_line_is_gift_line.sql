-- Discriminator flag marking a budget line as gift-derived.
--
-- Gift-derived lines are identified by pointing at the single `kind = 'gift'`
-- breakdown via `budget_line.breakdown_id`. This additive flag records the same
-- fact independently of `breakdown_id`, so gift lines can be keyed off a
-- dedicated column and the gift breakdown retired. This slice only lands the
-- column and backfills it; no code reads it yet.

alter table public.budget_line
  add column is_gift_line boolean not null default false;

comment on column public.budget_line.is_gift_line is 'True for a gift-derived line — both the per-member "Gifts for <member>" lines and the external "others" line — identifying it independently of breakdown_id.';

-- Backfill: every line currently owned by a household's gift breakdown is a
-- gift-derived line.
update public.budget_line
  set is_gift_line = true
  where breakdown_id in (select id from public.breakdown where kind = 'gift');
