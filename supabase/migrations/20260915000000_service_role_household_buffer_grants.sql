-- Grant service_role select on the breakdown and gift tables the household-buffer
-- loader reads.
--
-- `_shared/householdBuffer/bundle.ts` (`loadBudgetSummaryBundle`) — wired in by
-- both `notify-eval` (the daily buffer / goal-ETA evaluator) and `intent-summary`
-- (the iOS Siri buffer query) on a service-role client — reads `breakdown`,
-- `breakdown_item`, `gift_budget`, `gift_recipient`, and `gift_discretionary_budget`
-- to re-derive the breakdown and gift budget-line amounts client-side, exactly as
-- the PWA's `summariseHousehold` does. None of the five carried a `service_role`
-- grant (they are `authenticated`-only), so the loader raised `permission denied
-- for table breakdown` for every household — breaking every `intent-summary`
-- response and the `buffer_negative` / goal-ETA notification triggers.
--
-- This supersedes the note in `20260905000000_notification_triggers.sql` that the
-- evaluator "needs neither the breakdown nor the gift tables": that held while
-- `notify-eval` read `budget_line` straight, and stopped holding once it moved
-- onto the shared `_shared/householdBuffer/` loader.
--
-- Read-only and RLS-neutral: RLS stays enabled on all five, the household's own
-- `authenticated` policies are unchanged, and `service_role` — which bypasses RLS
-- but still needs the table-level grant — gains `select` only, no write.

grant select on
  public.breakdown,
  public.breakdown_item,
  public.gift_budget,
  public.gift_recipient,
  public.gift_discretionary_budget
  to service_role;
