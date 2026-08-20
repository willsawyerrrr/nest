-- A deduction can be claimed at a work-use percentage of what it cost.
--
-- Most deductible expenses are not wholly work-related: a phone plan, a laptop,
-- a software subscription used on weekends too. The ATO wants the apportioned
-- figure, so the household has been doing that arithmetic by hand before typing
-- an amount in — which loses both the real cost and the split it applied, the
-- two things a later question about the claim would ask for.
--
-- `amount_cents` keeps its meaning exactly: the deductible figure, the single
-- source of truth every downstream reader (the tax estimate, the EOFY summary,
-- a group's total) already uses. What is added beside it is where that figure
-- came from — `full_amount_cents`, the whole cost, and `work_use_percent`, the
-- share of it claimed. Apportioning is snapshotted at save time exactly as a
-- distance-basis amount is, so a later change of mind about the split cannot
-- retroactively move a deduction already claimed.
--
-- `deduction_work_use_apportioned` holds the three columns to each other:
-- `amount_cents` IS the full cost at the stated percentage, rounded to the
-- nearest cent. The database enforces the arithmetic rather than trusting the
-- client to have done it, because a wrong `amount_cents` here is a wrong figure
-- on a tax return.
--
-- The percentage applies to the AMOUNT basis alone. A cents-per-kilometre claim
-- is priced from work-related kilometres already — the private trips are simply
-- not among the kilometres entered — so a percentage on top would discount the
-- claim twice. A distance-basis row is therefore pinned at 100%, which
-- `deduction_work_use_basis` holds it to.
--
-- `full_amount_cents` has no plain column default: "the whole of what
-- amount_cents already says" is not a constant, it depends on another column of
-- the same row, which `DEFAULT` cannot express. A BEFORE INSERT trigger fills it
-- from `amount_cents` when the writer leaves it null, the same shape
-- `snapshot_payslip_line_attracts_super` fills `attracts_super` with — so an
-- insert naming no work-use figures still satisfies `deduction_work_use_range`
-- and `deduction_work_use_apportioned` below, claimed in full at the column's
-- own 100%.
--
-- `create or replace function` and `drop trigger if exists` before `create
-- trigger`: every other statement in this file already tolerates a rerun (`add
-- column if not exists`, `drop constraint if exists … add constraint`), and a
-- migration whose completion is not yet recorded in `schema_migrations` — a
-- push that fails partway through, or two overlapping deploys — gets retried
-- from the top of the file. A bare `create function` or `create trigger` is the
-- one shape here that cannot survive that; a first deploy attempt hit exactly
-- this.

alter table public.deduction
  add column if not exists work_use_percent numeric(5, 2) not null default 100,
  add column if not exists full_amount_cents bigint;

-- Every row that predates the column claimed the whole of what it recorded.
update public.deduction set full_amount_cents = amount_cents where full_amount_cents is null;

alter table public.deduction alter column full_amount_cents set not null;

comment on column public.deduction.work_use_percent is 'The share of full_amount_cents claimed as deductible, as a percentage; 100 for a wholly work-related expense. Pinned at 100 on the distance basis, whose kilometres are work-related already.';
comment on column public.deduction.full_amount_cents is 'What the expense cost in full, in integer cents, before the work-use share was applied. Equal to amount_cents at 100%. amount_cents remains the deductible figure every reader uses. Defaults to amount_cents on insert when left unstated — see snapshot_deduction_full_amount.';

create or replace function public.snapshot_deduction_full_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.full_amount_cents is null then
    new.full_amount_cents := new.amount_cents;
  end if;
  return new;
end;
$$;
comment on function public.snapshot_deduction_full_amount() is 'Fills a deduction''s full_amount_cents from amount_cents when the writer leaves it null, so an insert naming no work-use figures is claimed in full: amount_cents is exactly what the expense cost, at the column''s own 100%.';

drop trigger if exists snapshot_full_amount on public.deduction;
create trigger snapshot_full_amount before insert on public.deduction
  for each row execute function public.snapshot_deduction_full_amount();

alter table public.deduction drop constraint if exists deduction_work_use_range;
alter table public.deduction add constraint deduction_work_use_range check (
  work_use_percent > 0 and work_use_percent <= 100 and full_amount_cents >= 0
);

alter table public.deduction drop constraint if exists deduction_work_use_apportioned;
alter table public.deduction add constraint deduction_work_use_apportioned check (
  amount_cents = round(full_amount_cents * work_use_percent / 100)
);

alter table public.deduction drop constraint if exists deduction_work_use_basis;
alter table public.deduction add constraint deduction_work_use_basis check (
  basis <> 'distance' or work_use_percent = 100
);
