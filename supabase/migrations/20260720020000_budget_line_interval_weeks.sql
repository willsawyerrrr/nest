-- The "every N weeks" cadence carries its interval N on the budget line, exactly
-- as it does on inflows: an amount allocated once every N weeks. Every other
-- frequency leaves it null; the check keeps the two in lockstep. The
-- every_n_weeks enum value already exists (added for inflows), so the column and
-- its check can live together in this single migration.

alter table public.budget_line add column interval_weeks int;

alter table public.budget_line add constraint budget_line_interval_weeks check (
  case frequency
    when 'every_n_weeks' then interval_weeks is not null and interval_weeks >= 1
    else interval_weeks is null
  end
);

comment on column public.budget_line.interval_weeks is 'Weeks between allocations for the every_n_weeks frequency; null for every other frequency.';
