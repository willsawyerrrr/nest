-- Order the household's savings goals into one queue and let a queued goal cap
-- its draw from freed capacity.
--
-- A goal with no linked Savings/Investments budget line is queued: it is saved
-- towards only once the goals ahead of it finish. `queue_position` orders the
-- queued goals and is rewritten 0..n by the drag-reorder; it is a client-managed
-- sort key, not a unique-enforced column — a transient duplicate during a
-- reorder write is harmless and the client re-sorts by (queue_position, name).
-- `planned_contribution_cents` optionally caps the fortnightly amount a queued
-- goal draws from the growing freed pool; null draws the whole available pool
-- and the remainder cascades to the next queued goal. Both nullable, no default
-- and no backfill: an existing goal keeps null for both and its behaviour is
-- unchanged. The projection math is pure, in `@nest/plan`'s `projectGoalQueue`.
--
-- RLS and grants are unchanged: the `household members manage savings goals`
-- policy and the `authenticated` CRUD grant already cover the new columns, as
-- does the `service_role` select grant.

alter table public.savings_goal
  add column queue_position integer,
  add column planned_contribution_cents bigint
    constraint savings_goal_planned_contribution_nonneg
      check (planned_contribution_cents is null or planned_contribution_cents >= 0);

comment on column public.savings_goal.queue_position is
  'Order among the household''s queued (unfunded) goals; null sorts after positioned goals. Ignored while the goal has linked budget lines. Rewritten 0..n on drag-reorder.';
comment on column public.savings_goal.planned_contribution_cents is
  'Optional cap on the fortnightly amount this goal draws from freed capacity once queued; null draws the whole available pool. The remainder cascades to the next queued goal.';
