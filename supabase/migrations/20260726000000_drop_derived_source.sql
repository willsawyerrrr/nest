-- Drop the derived-source mechanism now that breakdowns fully replace it.
--
-- Derived budget lines are owned by a breakdown via `budget_line.breakdown_id`;
-- the `budget_derived_source` enum and `budget_line.derived_source` column are
-- read by nothing and can go.

alter table public.budget_line drop column derived_source;
drop type public.budget_derived_source;
