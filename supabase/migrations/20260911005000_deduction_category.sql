-- A deduction states what kind of expense it is: a work expense, a donation,
-- or tax agent fees.
--
-- A charitable donation and tax agent fees are both genuine deductions the
-- household claims, but neither is apportioned by work use the way a phone
-- plan or a laptop is — a donation receipt is either the full receipted amount
-- or nothing, and so are tax agent fees. Without a notion of kind, the add
-- form asked every deduction "Work use %", a non-sequitur on a donation, and
-- receipt extraction expected every document to be a purchase receipt or
-- invoice, rejecting a genuine DGR donation tax receipt outright.
--
-- `category` is deliberately not a two-way donation/work-expense split: the
-- household also claims tax agent fees (ATO label D10) today, and the set is
-- extensible for any future kind that is not itself a `super_contribution`.
-- **Personal deductible super contributions are excluded from this column on
-- purpose.** They are entered on the Super tab as
-- `super_contribution.kind = 'personal_deductible'`, which already reduces
-- taxable income and feeds the concessional-cap tracking there; adding one as
-- a `deduction` too would double-count it against taxable income and bypass
-- cap tracking entirely.
--
-- `deduction_work_use_basis` already pins `work_use_percent` to 100 on the
-- distance basis, whose kilometres are work-related already. The same pin now
-- also applies whenever `category` is not `work_expense`: a donation and a tax
-- agent fee are claimed in full or not at all, never apportioned, so the
-- constraint is extended in place — it is the same rule (work use is pinned at
-- 100% wherever apportioning does not apply), not two rules that happen to
-- share a column.

do $$
begin
  if to_regtype('public.deduction_category') is null then
    create type public.deduction_category as enum ('work_expense', 'donation', 'tax_agent_fees');
  end if;
end $$;

comment on type public.deduction_category is 'What kind of deductible expense a deduction is: ''work_expense'' (the default, apportionable by work use), ''donation'', or ''tax_agent_fees''. Never ''personal_deductible'' super contributions, which are entered on the Super tab as super_contribution.kind instead.';

alter table public.deduction
  add column if not exists category public.deduction_category not null default 'work_expense';

comment on column public.deduction.category is 'What kind of deductible expense this is. Pins work_use_percent to 100 for every category except ''work_expense'' — see deduction_work_use_basis.';

alter table public.deduction drop constraint if exists deduction_work_use_basis;
alter table public.deduction add constraint deduction_work_use_basis check (
  (basis <> 'distance' and category = 'work_expense') or work_use_percent = 100
);
