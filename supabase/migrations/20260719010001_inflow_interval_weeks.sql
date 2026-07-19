-- The "every N weeks" cadence carries its interval N on the inflow. Every other
-- schedule leaves it null; the check keeps the two in lockstep.

alter table public.inflows add column interval_weeks int;

alter table public.inflows add constraint inflows_interval_weeks check (
  case schedule
    when 'every_n_weeks' then interval_weeks is not null and interval_weeks >= 1
    else interval_weeks is null
  end
);

comment on column public.inflows.interval_weeks is 'Weeks between payments for the every_n_weeks schedule; null for every other schedule.';
