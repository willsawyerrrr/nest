-- Generalise the recurring interval to a single count column shared by both the
-- every_n_weeks and every_n_months cadences. The unit is read from the frequency
-- (weeks or months), so one interval_count column carries N for either. Each
-- table's check keeps the count in lockstep with its frequency: present and
-- positive for the two interpolated cadences, null for every fixed frequency.

-- inflows (enum column: schedule)
alter table public.inflows drop constraint inflows_interval_weeks;
alter table public.inflows rename column interval_weeks to interval_count;
alter table public.inflows add constraint inflows_interval_count check (
  case
    when schedule in ('every_n_weeks', 'every_n_months')
      then interval_count is not null and interval_count >= 1
    else interval_count is null
  end
);
comment on column public.inflows.interval_count is 'Count of the every_n_weeks/every_n_months interval (weeks or months, read from the schedule); null for every fixed schedule.';

-- budget_line (enum column: frequency)
alter table public.budget_line drop constraint budget_line_interval_weeks;
alter table public.budget_line rename column interval_weeks to interval_count;
alter table public.budget_line add constraint budget_line_interval_count check (
  case
    when frequency in ('every_n_weeks', 'every_n_months')
      then interval_count is not null and interval_count >= 1
    else interval_count is null
  end
);
comment on column public.budget_line.interval_count is 'Count of the every_n_weeks/every_n_months interval (weeks or months, read from the frequency); null for every fixed frequency.';

-- breakdown_item (enum column: frequency)
alter table public.breakdown_item drop constraint breakdown_item_interval_weeks;
alter table public.breakdown_item rename column interval_weeks to interval_count;
alter table public.breakdown_item add constraint breakdown_item_interval_count check (
  case
    when frequency in ('every_n_weeks', 'every_n_months')
      then interval_count is not null and interval_count >= 1
    else interval_count is null
  end
);
comment on column public.breakdown_item.interval_count is 'Count of the every_n_weeks/every_n_months interval (weeks or months, read from the frequency); null for every fixed frequency.';

-- super_contribution (enum column: frequency)
alter table public.super_contribution drop constraint super_contribution_interval_weeks;
alter table public.super_contribution rename column interval_weeks to interval_count;
alter table public.super_contribution add constraint super_contribution_interval_count check (
  case
    when frequency in ('every_n_weeks', 'every_n_months')
      then interval_count is not null and interval_count >= 1
    else interval_count is null
  end
);
comment on column public.super_contribution.interval_count is 'Count of the every_n_weeks/every_n_months interval (weeks or months, read from the frequency); null for every fixed frequency.';
