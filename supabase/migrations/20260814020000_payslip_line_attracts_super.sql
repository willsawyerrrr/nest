-- Snapshot the ordinary-time-earnings decision on each earnings line.
--
-- The employer super guarantee accrues on ordinary time earnings, not on an
-- allowance paid on top, and `inflows.attracts_super` records which an inflow is.
-- Reading that flag through the line's inflow at display time makes a past slip's
-- expected super depend on the inflow's present state: `source_inflow_id` is
-- `on delete set null`, so retiring an on-call inflow re-inflates every
-- historical slip's super base — a fortnight of $5,000 salary plus $495.50
-- on-call jumps from a $5,000 base to $5,495.50, expecting $659.46 of guarantee
-- instead of $600, and years of correct slips start reading "$59.46 below plan".
--
-- A payslip is a historical record, so the decision is snapshotted on the line
-- the way every other actual on the slip is. The line carries its own
-- `attracts_super`, taken from the inflow it draws on when it is written and
-- fixed from then on. A line drawing on no inflow is ordinary time earnings,
-- which is what an unclassified earning on a slip is.

alter table public.payslip_line
  add column attracts_super boolean;

-- Existing lines take the decision their inflow holds today, which is the same
-- one they were entered under.
update public.payslip_line l
  set attracts_super = coalesce(i.attracts_super, true)
  from public.inflows i
  where i.id = l.source_inflow_id;
update public.payslip_line
  set attracts_super = true
  where attracts_super is null;

-- No default: the trigger below fills an unspecified value from the inflow, and
-- a column default would pre-empt it.
alter table public.payslip_line
  alter column attracts_super set not null;

comment on column public.payslip_line.attracts_super is 'Whether the line is ordinary time earnings the employer super guarantee accrues on, snapshotted from its inflow when the line is written; false for an allowance (e.g. on-call) that is taxed but earns no super.';

-- Insert only: the snapshot is taken once, when the line is written. An update —
-- including the `on delete set null` that clears source_inflow_id when the inflow
-- is retired — leaves the recorded decision exactly as it was.
create function public.snapshot_payslip_line_attracts_super()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.attracts_super is null then
    new.attracts_super := coalesce(
      (select i.attracts_super from public.inflows i where i.id = new.source_inflow_id),
      true
    );
  end if;
  return new;
end;
$$;
comment on function public.snapshot_payslip_line_attracts_super() is 'Fills an earnings line''s attracts_super from the inflow it draws on when the writer does not state it; a line naming no inflow is ordinary time earnings.';

create trigger snapshot_attracts_super before insert on public.payslip_line
  for each row execute function public.snapshot_payslip_line_attracts_super();
