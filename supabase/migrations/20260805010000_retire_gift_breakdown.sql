-- Retire the gift breakdown: gifts roll up standalone, keyed by
-- `budget_line.is_gift_line`.
--
-- Gift-derived budget lines are identified by `budget_line.is_gift_line` and
-- derived directly from the `gift_*` tables — they need no `breakdown` row. This
-- contract step severs every gift line from its breakdown and deletes the
-- `kind = 'gift'` breakdowns, leaving the Breakdowns product generic-only.
--
-- Ordering matters: `budget_line.breakdown_id` references `breakdown` with
-- `on delete cascade`, so the gift lines must be detached (their `breakdown_id`
-- nulled) BEFORE the gift breakdowns are deleted, or the cascade would delete the
-- gift lines along with their breakdown.

-- a. Re-backfill idempotently, catching any gift line created between the expand
--    step (which added and backfilled `is_gift_line`) and this contract step.
update public.budget_line
  set is_gift_line = true
  where breakdown_id in (select id from public.breakdown where kind = 'gift');

-- b. Detach every gift line from its breakdown, so the delete below cannot cascade
--    to it. Gift lines are keyed by `is_gift_line` and derived from gift data.
update public.budget_line
  set breakdown_id = null
  where is_gift_line = true;

-- c. Delete the now-unreferenced gift breakdowns.
delete from public.breakdown where kind = 'gift';

-- The `'gift'` value of the `breakdown_kind` enum is intentionally left in place:
-- removing an enum value requires swapping the whole type (Postgres has no
-- `alter type ... drop value`), which is not worth the churn. It simply goes
-- unused — no breakdown row ever carries it again.

-- Self-check: no gift breakdown survives, and no gift line still points at one.
do $$ begin
  assert (select count(*) from public.breakdown where kind = 'gift') = 0,
    'No gift breakdown should remain after the contract migration';
  assert (select count(*) from public.budget_line where is_gift_line and breakdown_id is not null) = 0,
    'No gift line should still reference a breakdown after the contract migration';
end $$;
