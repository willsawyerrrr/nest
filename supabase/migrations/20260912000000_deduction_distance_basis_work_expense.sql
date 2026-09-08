-- The distance entry basis belongs to work expenses alone.
--
-- `basis = 'distance'` is the ATO cents-per-kilometre car method: kilometres
-- travelled, priced to dollars at the financial year's published rate. That is
-- a work-related travel deduction by definition — a charitable donation or a
-- tax agent fee is a receipted dollar figure, and no distance prices either.
-- The add form already hides the dollar/distance toggle for every category but
-- `work_expense`; this constraint holds the same rule in the database, the same
-- "a wrong figure here is a wrong figure on a tax return" reasoning
-- `deduction_work_use_apportioned` and `deduction_work_use_basis` follow.
--
-- `deduction_work_use_basis` already pins `work_use_percent` to 100 whenever the
-- basis is `distance` or the category is not `work_expense`, but it does not
-- forbid the pairing outright — a `distance` donation could still be written
-- with `work_use_percent = 100` and pass. This closes that off.

alter table public.deduction drop constraint if exists deduction_distance_basis_work_expense;
alter table public.deduction add constraint deduction_distance_basis_work_expense check (
  basis <> 'distance' or category = 'work_expense'
);
